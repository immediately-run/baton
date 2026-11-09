---
title: "12. Security"
description: "BATON_SPEC — 12. Security."
---
## 12. Security *(partly built; §12.8 proposal)*

- **Whose rules these are.** Every principal belongs to one tenant and authenticates only at
  that tenant's origin (R-BTN-137); the operator is not a principal (R-BTN-136).
- **Pushers are legitimate.** Whoever can push a registered repository's default branch is a
  legitimate user of it, and Baton does not fortify git (R-BTN-66). These rules keep people
  **without** push from gaining anything. No push changes the state Baton holds for authority:
  keys, grants, bars, holds, settings and the policy. What a push may move through the sync's
  attestations — positions, confirmations — each policy's `attestations` entry decides
  (R-BTN-188, R-BTN-191).
- **Who may push the default branch is the repository's policy** (§12.8, R-BTN-188). On one
  machine with trusted runners, runners may land their own work. Where runners are not trusted runners, the
  policy admits only trusted runners and humans to the default branch, and Baton never requires a
  runner to write it (R-BTN-180, R-BTN-182). Presets are conveniences; every knob is the owner's.
- **Owner gates are human gates only with a human-only credential** (R-BTN-185). An owner's
  agent sessions hold whatever the owner gives them; a gate that must stop them asks for a
  credential no session holds.
- **Sensitive legs act on attestations** (R-BTN-181): typed facts only a trusted writer makes,
  re-checked by a trusted runner at the moment it acts.
- **Cooperative, not a sandbox.** A leg runs as its runner's OS user, and nothing separates the
  sessions of one user (R-BTN-14). Baton runs no repository code (R-BTN-98) and checks no
  per-runner identity in git (R-BTN-46).
- **Content is data.** Text from git, runners and forges reaches a model only as quoted data and
  a screen only as text (§12.3).
- **No existence oracle.** A refusal never tells a caller whether something outside its reach
  exists: an unheld action, an unknown target and a foreign one answer alike.

### 12.1 Principals

Each principal, the routes it uses, how it authenticates and what it may do. A row's powers are
stated once, in the rule it cites.

| Principal | Routes | Credential | May |
|---|---|---|---|
| Runner (machine key) | `/v1/runner/*` | SSH-signed (R-BTN-13) or API key (R-BTN-159), plus the runner secret (R-BTN-14) | heartbeat as its name; claim and act where it holds an active grant (R-BTN-58, R-BTN-146); post readings (R-BTN-101); ask blocks (R-BTN-75); accept or decline its grants, key alone (R-BTN-146); as a signed key, sync a granted repository (R-BTN-102) and deliver outbox entries where the policy admits `runner` (R-BTN-171) |
| Trusted runner | `/v1/runner/*`; as the fact reader, `GET …/fact-legs` and `POST …/attestations` | SSH-signed, on a grant with the `trusted-runner` role (R-BTN-180); its forge credential is the only non-human one able to perform its legs' actions | heartbeat as its name; claim, advance and end legs marked `trusted: true`; deliver outbox entries where the policy admits its role (R-BTN-171); as the fact reader, attest forge facts as its `service:` key (R-BTN-192); as the protection checker, report `protection` and nothing else (R-BTN-180, R-BTN-182) |
| Owner's agent | the owner's routes | an owner key not registered `human_only` | an owner's actions, as `owner`; never a `human` attestation or a human gate (R-BTN-185) |
| Check-runner | `/v1/runner/*`; `POST …/attestations` as a `service:` key the policy names | SSH-signed, plus the runner secret | heartbeat as its name; claim, advance and end check tickets; report activities and transcripts, write leg logs; where the policy's `attestations` names its key for `std:checks@1`, post that attestation (R-BTN-115); nothing else (R-BTN-114) |
| Board sync, mirror | `/v1/sync/*` | the repository's sync or mirror key, or a CI identity token (R-BTN-93, R-BTN-156) | sync: observation numbers and board posts; mirror: read events; both: sync wants (R-BTN-94) |
| Forge notification | `POST /v1/forges/{repository}/notify` | the forge's verifier under `BATON_FORGE_SECRETS` (R-BTN-95) | record a sync want for its own repository (R-BTN-156) |
| GitHub App webhook | `POST /v1/github/webhook` | `X-Hub-Signature-256` by the App's webhook secret (R-BTN-73) | trigger a sync dispatch; Baton reads only R-BTN-73's fields |
| Instrument (probe) | `/v1/probe/*` | SSH-signed | post readings of any registered instance (R-BTN-101) |
| Registration token | `POST /v1/register` | `Authorization: Baton-Token <token>` | register one credential within its scope (R-BTN-117, R-BTN-157) |
| Administrator | `/v1/admin/*`; any claim's leg runs | a `BATON_ADMIN_KEYS` line, SSH-signed or API key | R-BTN-57 |
| Dashboard session | `/`, `/v1/ui/*`, `GET …/prerequisites` (R-BTN-120); an owner's, `POST …/attestations` (R-BTN-116) | the session cookie (R-BTN-155) | as `session` with its minting key's role (R-BTN-129): an administrator's, every action listed for it, under R-BTN-155's confirmations; an owner's, those listed for it on the repositories its key still owns, under the same confirmations, never an administrator's |
| Repository owner | `/v1/owner/{repository}/*`; the repository's reads and leg runs | an owner key, SSH-signed or API key | R-BTN-58 |
| Human-only key | `POST /v1/human-keys`; `POST`, `DELETE …/attestations` as writer `human`; as an owner, or as a break-glass line on every repository it satisfies (R-BTN-188), the owner's routes | an SSH key registered `human_only` (R-BTN-185), on an owner key or a key of no other role | open human gates: a `human` attestation, every action an `approvers.*` list names `human` for, `human-key.add` and `human-key.revoke`; as an owner, R-BTN-58; never through a session, which is `owner` (R-BTN-185) |
| MCP key (a delegated key) | `POST /v1/mcp` only | bearer `bmcp_…` | as `owner` on one repository, narrowed to the ids listed at minting: reads, tightenings and the undoing of its own; never an attestation, a route, an adopt, a credential or the policy (R-BTN-186, R-BTN-130) |
| Public | `POST /v1/login`, the dashboard's static assets | none | start a sign-in |

The repository reads (`GET /v1/repositories/{repository}/…`) are open to any key granted on the
repository, its owners and administrators, except where a route's rule narrows them.

- **R-BTN-179 (the state is readable with a key; B-90).** What the dashboard's state answers is
  answered to a signed key too, by the same queries — one request, one JSON answer:
  `GET /v1/admin/repositories` (administrators: the registry as `/v1/ui/state`'s
  `repositories`, plus `seed_owners` — the unretired repositories whose live owner keys are all the
  deploy seed's, or that have no live owner, R-BTN-58/B-91); `GET /v1/owner/{repository}/grants` (its owners: that repository's `owners`,
  `grants`, `mcp_keys` and `settings`, and the bars in force or scheduled, R-BTN-146, each grant also naming
  the `other_repositories` its key holds); and
  `GET /v1/repositories/{repository}/board` (the repository reads' principals: the repository,
  its `ready` tickets and `ready_by_tier`, `granted_capabilities`, the repository's live claims
  as `holders` — each with its holder and when its lease ends (null for a legacy claim), the
  lock a session claiming through git reads (B-129) — and `server_time`). A key outside the route's role is refused as this
  section says — `forbidden`, or `unauthenticated` for a key Baton does not know. The CLI's
  `baton admin repo list`, `baton owner grant list <repository>` and `baton repo board
  <repository>` are those requests (R-BTN-127). The board's `granted_capabilities` names the capabilities the key's grant holds on
  that repository — the same grant the heartbeat's answer names for a runner that declared it —
  and is null for a key no grant binds there, an owner's or an administrator's included.

- **One role per key.** In a tenant every key holds exactly one role: administrator, owner,
  runner, check-runner, instrument, sync or mirror; `human_only` is a mark, not a role, carried
  by an owner key or by a key of no other role (R-BTN-185). Registering a key that holds
  another role is refused `conflict`, whatever its kind (SSH or API); the refusal does not name
  the role. A machine key whose every grant is pending and was never accepted holds no role yet,
  so a grant naming any public key reserves nothing; its acceptance is checked as a
  registration. `baton admin keys set` refuses a line whose key holds another role, and a host
  that loads one anyway treats it as no administrator and raises `baton.admin-key-conflict`. Administrator and owner
  keys are never machine keys. The rule holds within a tenant; another tenant may hold the same
  public key (R-BTN-137).
- **Bearer secrets** — API keys (`bak_`), registration tokens (`brt_`), MCP keys (`bmcp_`),
  pending sign-ins (`bps_`) and dashboard sessions (`bds_`) — are stored only as hashes, are
  valid in one tenant, and are compared over their full digests in constant time; so is every
  forge and webhook MAC.

### 12.2 Destructive actions

These actions take `confirm: true` in the body, or are refused `confirm-required`; the CLI asks
or takes `--yes`, and the dashboard's dialogs send it. Over MCP `confirm` is only a schema check
(R-BTN-130).

- `ticket.cancel`, `leg.stop`, `claim.force-reap`, `claim.fence-clear`;
- `owner.owner.remove`, `owner.grant.revoke`,
  `owner.check-runner.revoke`, `owner.sync-key.revoke`, `owner.token.revoke`,
  `owner.mcp-key.revoke`, `owner.sessions.revoke`, `attestation.revoke`, `human-key.revoke`;
- `admin.key.revoke`, `admin.repo.retire`, `admin.repo.resync`, `admin.sessions.revoke`.

Two further changes take `confirm: true`: a repository's path (R-BTN-138) and a `code_repos`
consent (R-BTN-140). A dashboard session's authority-changing actions also need a
confirmation code (R-BTN-155).

### 12.3 Untrusted text

Every value below is validated on write; a value over its cap is refused `invalid-params`.

- **Free text** (`session_name`, an activity's `label`, `end_reason`, message payloads,
  rate-limit details): `session_name` by R-BTN-3's pattern; every other at most 500 characters,
  with no control characters and none of `<`, `>`, `{`, `}`, `` ` ``. The backtick ban keeps a
  mirrored code span from being closed.
- **Activity `detail`** (§9.9): an object of at most 16 keys matching
  `^[a-z][a-z0-9_]{0,31}$`, whose values are numbers, booleans, free-text strings or a
  pull-request URL, plus under the one key `resume` a nested object under the same rules; at
  most 2 KB. A pull-request URL is the `web_base` (R-BTN-92) of the ticket's home, or of a
  `repos:` entry with reach (R-BTN-140), followed by the forge's path: `/pull/<n>` on GitHub,
  `/pulls/<n>` on Gitea, `/-/merge_requests/<n>` on GitLab, none on a plain `git` repository.
- **Identifiers.** A ticket's local id matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and is
  qualified as `<repository id>:<local id>` (R-BTN-47); a decision id or restart id matches
  `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`, the prefix `baton.` reserved to core; an `asks` label
  matches `^[a-z][a-z0-9-]{0,31}$`; a condition type follows R-BTN-160. This is the ticket-id rule
  the other sections cite.
- **Ticket versions and keys** (B-183): a ticket's `version` — the ticket source's opaque
  string — matches `^[A-Za-z0-9._:+/=-]{1,128}$`; its `key`, the source's stable name, matches
  `^[A-Za-z0-9][A-Za-z0-9._:+/=-]{0,255}$`. Both are untrusted text validated on write; Baton
  compares each for equality only (values 4), never orders two and never reads one as a time.
- **Links.** Every link Baton accepts or draws passes R-BTN-92's link rule for one of the
  ticket's repositories with reach (R-BTN-140), or names a host an administrator allowed:
  `link_hosts` for a view's `link` (R-BTN-112), `session_hosts` for a session link
  (R-BTN-113). A person leg's question `url` (R-BTN-116) and a condition's `url` (R-BTN-160) are the
  only links they carry; one that fails the rule is dropped, so no `javascript:` link reaches a
  screen. `needs` names follow R-BTN-76.
- **URIs** (R-BTN-82), at most 1 KB, are one of:
  - `git:<owner>/<name>@<40-hex>:<path>` or `git:<owner>/<name>#blob=<40-hex>`, where the path is
    relative, at most 512 characters of `[A-Za-z0-9._/-]`, with no empty, `.` or `..` segment;
  - an `https://` URL under the repository's forge, checked as a decision's `url`;
  - `s3://<bucket>/<key>?versionId=…` with the bucket in the owners' `artifact_buckets`.

  A `git:` or `https://` URI names the ticket's home or a `repos:` entry with reach
  (R-BTN-140). A non-`git:` URI needs a `digest`. A URI is stored as text and drawn as a link
  only when `https://`.
- **Markers** (§9): every field value is percent-encoded, RFC 3986 unreserved characters
  only, so no value holds a space, a quote or `-->`; `locate` decodes before validating.
- **Opaque blobs** (course data, a ticket's and a leg's course fields, a runner's profile and
  reports, readings' `detail`) are JSON stored verbatim and never rendered as markup, so the
  brace rule does not apply: at most 16 KB per blob and 256 KB of a repository's course data.
- **Rendering.** The dashboard renders text only through `textContent`, never `innerHTML`, and a
  blob only as pretty-printed JSON. `baton leg log` strips terminal escapes and every C0 and C1
  control but newline and tab (R-BTN-128).
- **Models.** Profiles, reports, readings' `detail`, course fields, resume records, hand-off
  documents and an earlier claimant's text reach a model only as quoted data, in their own file,
  never in instructions (R-BTN-144, R-BTN-152).
- **The mirror** (§16) runs `check-note-mdx` on every note it writes, with free text in code
  spans; a failing note is written without its free text and flagged. §16 states the export's fence.

### 12.4 Same-site with the product

- **R-BTN-16 (same-site with the product).** A Baton may share its registrable domain with
  origins that run untrusted code. So, on every host:
  - **Cookies.** Baton sets two cookies and reads no other: the dashboard session
    `__Host-baton_session` (at most 4 hours) and the pending sign-in `__Host-baton_pending` (2
    minutes), both `__Host-` prefixed, host-only, `Secure`, `HttpOnly` and `SameSite=Strict`, so
    no other origin on the domain can set or shadow them (R-BTN-155).
  - **Headers.** Every response carries `Content-Security-Policy: default-src 'self';
    frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`,
    `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
    and `Cross-Origin-Resource-Policy: same-origin`; every response to a request a credential
    or a dashboard session authorizes, and every response that sets a cookie or carries a
    sign-in code (`POST /v1/login`, R-BTN-155), also carries `Cache-Control: no-store`.
  - **Writes.** A state-changing request a dashboard session authorizes, under `/v1/ui/*` or
    not (`POST …/attestations`, R-BTN-116), and `POST /v1/login` must carry
    `Content-Type: application/json` and an `Origin` equal to the tenant's origin
    (`BATON_ORIGIN`; locally `--origin`), else `forbidden`.
  - **Every session request.** Any request a dashboard session authorizes, reads included,
    carries an `Origin` equal to the origin when it carries one, and `Sec-Fetch-Site:
    same-origin` when it carries that header, else `forbidden`.
  - **Sessions.** `/v1/ui/*` requires a dashboard session minted from an administrator or owner key
    (R-BTN-155).
    Cloudflare Access may stand in front of the dashboard as extra hardening; Baton never
    requires it and never reads its cookie. Where it stands, it covers only the dashboard's
    pages (`/`, `/login`, `/oauth/authorize`), `POST /v1/login` and `/v1/ui/*`, and is bypassed
    on every other route, which authenticates every request itself or is public: keys,
    webhooks, forge notifications, instruments, CI identities and MCP clients call
    them without an Access cookie.

### 12.5 The local host and bearers

- **R-BTN-158 (the local host, and bearers over `http`).**
  - **Binding.** `baton server start` binds `127.0.0.1` unless `--bind <address>` says otherwise.
    TLS is the operator's: a front (a reverse proxy, Tailscale serve) terminates it, and
    `--origin` names the front's origin, against which R-BTN-135's host check holds. A
    non-loopback `http` origin gets no dashboard, because its cookie is `Secure`.
  - **Bearers never cross `http`.** The CLI and the runner refuse to send a
    bearer to a non-loopback `http` origin; that is the control. The server detects:
    - the Cloudflare host refuses a bearer on a plain-`http` URL as `unauthenticated`;
    - an `http` listener refuses every bearer (API keys, MCP keys, registration tokens, the
      dashboard cookie) as `unauthenticated` when the connection's peer is neither loopback nor
      the `--trusted-proxy`, whatever the origin says, and accepts SSH-signed requests from any
      peer;
    - either way, a bearer whose secret fully verifies is revoked at once (ending the session,
      for a cookie), because it crossed the network in clear, and raises
      `baton.bearer-over-http`. One that does not verify is only refused and counted in §2.3's
      failure buckets: an id or fingerprint alone, which is public, revokes nothing.
  - **The trusted proxy.** `--trusted-proxy <address>` names the one front whose forwarded
    client address Baton reads, for the sign-in limits (R-BTN-155).
  - **File modes.** At start the local host exits 2 on a group- or world-writable `--db`, secret
    file or directory, or a group- or world-readable secret file. It creates the database `0600`
    in a `0700` directory.
  - **Import** re-validates every row and refuses requests signed before the source's seal, as
    R-BTN-88 states.

### 12.6 Capability roles and links

- **R-BTN-157 (capability roles never reach a grant; links are bounded).** Registration
  tokens' bounds — role `runner` only, uses, lifetime, re-keys and bursts — are R-BTN-117's.
  - **Roles never reach a grant.** A course file whose `capability_roles` (R-BTN-121) names
    `human-operator`, another role, a capability or `none` is held (R-BTN-69). A grant holds
    capabilities only: the CLI expands a role from the repository's latest accepted snapshot
    (`GET …/courses`), never the working tree. Before signing a `<type>:*` grant the CLI prints
    every course defining the type, and asks for confirmation when their definitions differ.
  - **Links.** A `link_hosts` link (R-BTN-112) is an `https` URL with no userinfo.
    `context-handoff` links and `handoff_url` pass R-BTN-113's or R-BTN-92's rule, or are dropped
    and logged.

### 12.7 Baton's GitHub App

- **The dispatch App** is optional: Baton records that a sync is wanted and a runner pulls it
  (R-BTN-94); the App is GitHub's dispatch target, which Baton calls itself, and Baton's webhook
  source (R-BTN-73). Each tenant has its own, created by `baton admin github-app create`
  (R-BTN-57) and installed by an organisation owner on each registered repository and its
  `code_repos`.
  - **Permissions:** Actions: write; read-only Contents (`push`), Pull requests (`pull_request`,
    `pull_request_review`) and Issues (`issue_comment`). No Checks. Baton never reads repository
    content through it.
  - **Key.** Baton holds the App's private key as the Worker secret `BATON_GITHUB_APP_KEY` and
    mints short-lived installation tokens per repository from it, in the host shell's `Dispatch`
    (R-BTN-55), never in the object (§2.1). Baton's server is trusted with it (§12.8, the owner, 2026-11-01: a compromised
    Baton is recovered, not resisted, and it already decides which commit every runner runs).
    Without the App, a repository's workflows run on their schedule and runners answer wants.
  - **Dispatch only what is named.** Actions: write lets the App dispatch any workflow, so Baton
    dispatches only a repository's `sync_workflow`, `mirror_workflow` (*adoption*) and its owners'
    unblocked trigger, whose workflow is limited by R-BTN-94. A repository whose other workflows must not
    be triggered gives them no `workflow_dispatch`.
- **The check App is another App** (R-BTN-115), created by `baton admin check-app create --org
  <org> --key-out <path>` through the same manifest flow (R-BTN-57) with Checks: write and no
  other permission; its private key is written to `--key-out` on the delivering runner's host,
  never to the secret sink, and its App id to the instance setting `check_app_id` (`PUT
  /v1/admin/settings`, §13.1), one per tenant as the App is, which the sync is handed with its
  observation, the policy read answers, and R-BTN-115's read-back and `baton repo protect --print`
  read. An organisation owner installs it on each repository whose `checks` setting names a course,
  never on "All repositories" (R-BTN-115). Branch protection names it,
  never the dispatch App: the merge check is a gate against Baton as much as against any token
  (R-BTN-115).
### 12.8 The repository policy and its guarantees *(proposal — B-127, B-131, B-133, B-136, B-137, B-139, B-140, B-145, B-146, B-147)*

Baton specifies mechanisms, each with what it guarantees; a repository's **policy** chooses which
of them hold. The policy is Baton state, one document per repository, set by its owners and never
read from git. Baton names no mode: `cooperative`, `protected` and `protected-hardware` are
presets, sets of values an owner applies and then tunes (R-BTN-188). What a policy guarantees is
computed from its values (R-BTN-189), so a deployment that depends on Baton, such as Fieldhouse,
requires guarantees by name and lists them as the policy's floors, which Baton enforces. A small
team running runners on one machine needs none.

**Baton's server is trusted.** Its compromise, or its Cloudflare account's (reach 0 of
`docs/security-model.mdx`), is recovered by B-125's runbook, not resisted (the owner, 2026-11-01,
"Out of scope"). So nothing here is built for a verifier that distrusts Baton: Baton signs no
outbox entry and no policy read, publishes no signing key, a trusted runner pins nothing and acts
on Baton's record as Baton gives it, and the claim response carries no roll-back check. What
Baton records, Baton may be asked for; who may tell Baton something is the question every rule
below answers.

**Outside every guarantee, stated exactly:**
- a compromised runner that is itself one of the reviewers `merge.reviews` requires, and whose
  change or findings persuade the other reviewers' models, lands it; a repository whose default
  branch is itself deployed puts `**` in `paths.protected` so a human approves every merge;
- what the deployment must make true and Baton cannot observe: that a review leg runs no branch
  code, that a domain which ran a branch's code is reset before it serves another ticket, that a
  trusted runner's domain is shared with no other grant, that a trusted leg's override
  (R-BTN-182) runs without the trusted runner's credential, and where runners, trusted runners and
  their keys live (never on a machine an agent session drives, for a deployment that relies on
  `human-gates`). Baton records the declarations (R-BTN-183); a deployment that relies on them
  states and enforces them itself;
- a human-only key an agent session can use (always possible while the repository's `human_key`
  is `any`, which is why `human-gates` holds only under `hardware`);
- a compromised host of trusted runners or of the protection checker (R-BTN-180);
- for reviews counted by run label (R-BTN-180), a compromised runner of a listed credential, or a
  leg that can act as it (under a runner whose legs share its trust boundary, every leg can: §8,
  R-BTN-107): Baton records run labels and cannot tell whether runs were kept apart;
- refs no forge rule restricts: on GitHub, `refs/baton/*`; Baton reads nothing from them that a
  trusted leg acts on;
- a human who approves a change they misread;
- a compromised Baton server or Cloudflare account, as above;
- a compromised forge.

The worked example is a course that turns a merged spec into tickets: its `decompose` leg writes
ticket files on a branch; two reviews, from domains that never ran the branch's code, are
attested by Baton; the owner, shown the computed change, attests approval of those files at that
commit with a human-only key; the merge runner, a trusted runner, re-checks every attestation
against the exact commit and merges it. It needs the guarantees `tickets-approved`,
`independent-review` and `human-gates`.

- **R-BTN-188 (the repository policy).** Every rule about authority and trust that an agent must
  not change, and that Baton, the forge or a trusted runner enforces, is one knob of the
  repository's policy. A rule none of the three can enforce is not policy: it is the
  deployment's (§12.8).
  - **One versioned document.** The policy is a JSON document with one current version per
    repository. Each change is a new version in an append-only log (`repository_policies`):
    the document, its SHA-256 over RFC 8785 canonical JSON, the previous version's hash, the
    credential that made it, the approver class it met, the preset it applied if any, and the
    time. `PUT /v1/owner/{repository}/policy {base_version, policy | preset}` (`baton owner policy
    set <file> | apply <preset>`) is a compare-and-set on `base_version` (`conflict` when stale);
    `baton owner policy show | diff | log` read it. With `dry_run: true` it writes nothing and
    answers what the change would do: the knobs changed, each guarantee held or broken after it,
    and what the new values would stop — grants whose role the new `outbox` no longer admits to a
    class they deliver or whose null domain now counts toward nothing, queued legs whose
    requirements the new `attestations` entries admit no writer for, tickets on a course whose
    `merge` leg a new `merge.trusted` leaves without a trusted runner, and, for a change to
    `domains.per_run`, the credentials listed or un-listed, the course legs whose `no_chain_from`
    then admits a listed credential's labelled run from another claim (R-BTN-106) (`baton owner
    policy apply <preset> --dry-run`); `baton owner
    policy show` lists the per-run credentials beside the guarantees. Each change is logged `admin` with the versions and the
    knobs it changed. Every change is checked against the floors (R-BTN-189) and the current
    courses (R-BTN-181) in its transaction.
  - **Who may change it.** Every change to the policy, in any direction, needs an approver on the
    `approvers.policy` list, as the list stands before the change; Baton never asks whether a
    change tightens or loosens. An `attestations` or `readings` entry that is absent admits no
    writer.
  - **The knobs and the presets.** The `cooperative` column is a new repository's policy on a
    forge, and the `plain-git` preset (below) is a new repository's policy where `forge` is `git`.
    `protected-hardware` equals `protected` except where its column says otherwise.

    | Knob | `cooperative` | `protected` | `protected-hardware` | Enforced by | Rule |
    |---|---|---|---|---|---|
    | `approvers.members` — adding or removing owners; granting or revoking runner keys; registering check-runners, sync and mirror keys (instrument keys are the administrator's, tenant-wide, R-BTN-101); consenting to another home's `code_repos` entry (R-BTN-140); minting registration tokens and MCP keys | `[owner]` | `[human]` | | Baton | R-BTN-58, R-BTN-93, R-BTN-114, R-BTN-117, R-BTN-130 |
    | `approvers.roles` — a grant's role (`runner`, `trusted-runner`), its domain, and whether it is the protection checker | `[owner]` | `[human]` | | Baton | R-BTN-180 |
    | `approvers.policy` — every change to this policy, this list and `floors` included, every loosening of an R-BTN-66 setting (R-BTN-186), and every `baton ticket adopt` (R-BTN-39) | `[owner]` | `[human]` | | Baton | R-BTN-186, R-BTN-189 |
    | `human_key` — the minimum for a human-only key acting on this repository; the instance's is a floor under it | `any` | `any` | `hardware` | Baton | R-BTN-185 |
    | `human_identity` — the human-only identity (R-BTN-185) as the fact reader and the merge runner see it: on a forge its immutable forge user id (R-BTN-138's kind), on `git` the pusher identity the `pre-receive` hook logs (R-BTN-180); the owners set it before applying `protected`, since Baton refuses `paths.control: human`, or an `attestations` entry admitting no `sync` for `std:arrival@1`, while it is null (`invalid-params`, naming it) | null | no value: an apply never writes it | no value | Baton, trusted runners | R-BTN-184, R-BTN-192 |
    | `refs.default_branch`, `refs.tags`, `refs.other` (branches outside `branch_pattern`, `baton/proposed/*` among them, `baton-legs/*` not) — who may update them, from `runner`, `trusted-runner`, `mirror` (*adoption*; on its deletion it stays legal and inert in stored versions and is refused in new ones, §16), `human` | all four, for each | `[trusted-runner, human]` for each | | the forge; Baton prints it, the protection checker checks it | R-BTN-180 |
    | `paths.protected` — the owner's protected paths, beside the computed floor | `[]` | `[]` | | trusted runners, the forge | R-BTN-184 |
    | `paths.control` — who lands a control path | `any` | `human` | | trusted runners, the forge | R-BTN-184 |
    | `paths.tickets` — a ticket or goal change the merge runner merges needs a `std:approval@1`; a human's own merge of a ticket's PR (`merged-by-hand`, R-BTN-131), or of a request PR (R-BTN-131), is their approval of the ticket files it carries | `any` | `approval` | | trusted runners | R-BTN-183, R-BTN-184 |
    | `merge.trusted` — merge legs are trusted legs, and no course commits to the default branch | `false` | `true` | | Baton, the forge | R-BTN-182 |
    | `merge.reviews` — `{count}`: the `std:review@1` a merge needs at its head, from `count` distinct domains, each other than every writer domain | `{count: 0}` | `{count: 2}` | | trusted runners | R-BTN-183 |
    | `domains.per_run` — the credentials, by key fingerprint, whose runs each carry a run label (R-BTN-180) | `[]` (no value when applied) | no value | | Baton | R-BTN-180, R-BTN-183 |
    | `merge.checks` — `optional`, or `required`: the protected default branch's check runs pass at the head, or a `std:checks@1` the owner named a writer for | `optional` | `required` | | trusted runners, the forge | R-BTN-183 |
    | `tickets.created` — how a ticket a runner's action creates (a handler ticket, a call leg's child, a supersession's replacement) and a withdrawal reach git | `filed` | `proposed` | | Baton, trusted runners | R-BTN-161, R-BTN-165, R-BTN-171, R-BTN-180 |
    | `outbox.git`, `outbox.forge-check` — `{deliverers}`: which grant roles may deliver the kind, from `runner`, `trusted-runner` | `{deliverers: [runner]}`, each | `{deliverers: [trusted-runner]}`, each | | Baton | R-BTN-171 |
    | `inputs.board` — who may post the board, from `sync-key`, `ci-identity`, `machine` | all three | `[sync-key, ci-identity]` | | Baton | R-BTN-93, R-BTN-102, R-BTN-187 |
    | `attestations` — `{<type>: writers}`: whose attestations about work count; an absent type admits none | each `std:` type's standard writer (R-BTN-181; R-BTN-191: `runner` for the holder's `std:arrival@1` and a deliverer's `std:effect@1`), with `sync` admitted for `std:arrival@1` and `std:decision@1` too (R-BTN-191) and `std:checks@1` absent until the owner names a check-runner's key (R-BTN-114) | as `cooperative`, except that `std:arrival@1` also admits the fact reader's `service:` key once the owner names it (R-BTN-192) and never `sync`, and `std:decision@1` admits `human` alone | | Baton, trusted runners | R-BTN-181 |
    | `readings` — `{<resource> \| "*": {writers}}`: whose readings count for this repository; `*` covers every resource not listed, one registered later included; a trusted leg's resources are further restricted by R-BTN-181 | `{"*": {writers: every writer R-BTN-76 lets report}}` | as `cooperative`; the owner narrows the resources a gate reads | | Baton | R-BTN-76, R-BTN-181 |
    | `floors` — the guarantees (R-BTN-189) no change to this policy may break | no value: an applied preset never writes it | no value | no value | Baton | R-BTN-189 |

    Owner settings kept outside the policy (`retry`, bars, `checks`,
    `transcript_repos`, `leg_log_root`, `artifact_buckets`) stay R-BTN-66 settings, whose loosening
    `approvers.policy` governs. Three values that were knobs are constants: `refs/baton/*` is open
    to every writer (GitHub cannot restrict it, R-BTN-180); `baton-legs/*` is open to `runner`,
    `trusted-runner` and `human` (R-BTN-190); and where leg state lives follows the forge
    (R-BTN-190).
  - **Approvers.** Each `approvers.*` knob is a non-empty list; a credential is an approver for
    it when it matches an entry:
    - `owner`: any owner key or owner session of the repository; an administrator (R-BTN-57)
      matches an `owner` entry on every repository and no other;
    - `human`: any `human_only` key that is an owner of the repository and meets `human_key`
      (R-BTN-185);
    - `key:<fingerprint>`: that one key, and a dashboard session it minted when the key is not
      `human_only` (R-BTN-185), while it is an owner of the repository, and meeting `human_key`
      when it is a `human_only` key.

    A key becomes an owner of a repository only by that repository's `approvers.members` action;
    registering a `human_only` key with the tenant (R-BTN-185) makes it an owner of nothing.

    A delegated key (R-BTN-130, R-BTN-186) matches no entry: it never changes the policy or its
    floors, nor performs any action an `approvers.*` row governs. A list is **human-only** when
    every entry is `human` or names a `human_only` key; an action whose list is human-only is a
    **human gate**, for administrators too: an administrator performs it only with a `human_only`
    key the list admits.
  - **The list in force decides.** A change to any `approvers.*` list is authorised by
    `approvers.policy` as it stands before the change, never by the list being written.
  - **No gate without a key to open it.** Baton refuses a list no live credential can satisfy: a
    `key:` entry for a revoked, suspended or unknown key does not count, and a human-only list
    needs a `human_only` key meeting the resulting `human_key` among the repository's owners.
    Baton refuses removing an owner, or revoking or suspending a key, when a list would be left
    with no live credential to satisfy it (`unsatisfiable-approvers`, naming the list; R-BTN-57,
    R-BTN-185).
  - **Break-glass.** A key in the host's `BATON_HUMAN_KEYS` configuration (R-BTN-185) satisfies
    every `human` entry of every repository on the instance whose `human_key` it meets; a line that
    does not meet `hardware` satisfies nothing on a repository that requires it, so `human-gates`
    promises what it says. It is the deployment's root of trust, set outside Baton, and the only
    recovery from a lost key.
  - **Making `approvers.roles` human-only** clears every role, mark and domain set by a credential
    the new list does not admit (`runner_grants.set_by`, §13): each such grant is an ordinary
    `runner` with no domain until an approver on the list sets it again, and a cleared mark voids
    the checker's last report (R-BTN-180). A grant with a null domain counts
    toward no `merge.reviews` and is never a trusted runner.
  - **Presets** are the named columns above and `plain-git`, shipped with Baton. Applying one
    writes every knob it has a value for, which `floors`, `human_identity` and `domains.per_run`
    never are, so an
    apply neither sets nor clears a floor; in `attestations` it keeps every `service:<fingerprint>`
    entry the document already names for a type the preset admits a `service:` key for
    (`std:arrival@1`, `std:checks@1`), so an apply never un-names a fact reader or a check-runner.
    The stored document never names a preset, and no rule reads one.
  - **`plain-git`** is the `cooperative` column with what a repository with no forge cannot use
    taken out (R-BTN-92): `inputs.board` `[sync-key, machine]`, since CI identity tokens are
    GitHub's and GitLab's (R-BTN-156), and `outbox.forge-check` with no deliverers, since check
    runs are GitHub's (R-BTN-115). A `git` repository may apply `protected` or
    `protected-hardware` instead; Baton then writes those same two values with it, the refs being
    enforced by the `pre-receive` hook `baton repo protect --print` emits (R-BTN-180). Baton
    refuses, on a `git` repository, `ci-identity` in `inputs.board` and a `forge-check`
    deliverer, and on a repository whose ticket source is ejected (`.baton/tickets.mjs`,
    R-BTN-74) an `outbox.git` admitting only `trusted-runner`, naming the source: a trusted-runner
    deliverer writes no ejected source's withdrawals (R-BTN-171), so such a policy could never
    land one; and the other way, a snapshot that ejects the ticket source while `outbox.git`
    admits only `trusted-runner` is refused `snapshot-rejected`, the previous source staying in
    force (R-BTN-74), so a `protected` repository never ejects its source. Its leg state is the
    side branch, by R-BTN-190, not by a knob.
- **R-BTN-189 (guarantees and floors).**
  - **A guarantee** is a named condition over the policy, defined here, and held or broken for
    each version. A deployment defines its own guarantees in its own specification, out of these
    and of what it enforces itself; Baton knows only these. Each includes the guarantees it rests
    on. Each promises one thing, stated before its condition:

    | Guarantee | Promises | Holds when |
    |---|---|---|
    | `no-runner-lands` | no runner updates the default branch, a tag or a branch outside its pattern; a runner's work lands only through the merge runner under `merge.*`, as reviewed as `merge.reviews` says, or by the human identity's own merge of its PR (`merged-by-hand`) | `refs.default_branch`, `refs.tags` and `refs.other` admit only `trusted-runner` and `human`; `paths.control` is not `any`; `merge.trusted`; `tickets.created` is `proposed`; `outbox.git` admits only `trusted-runner`; and the latest report from the protection checker, within 24 hours, matched (R-BTN-180) |
    | `control-paths-human` | no control path (courses, workflows, agent configuration, the ticket source) changes without a human landing it | `no-runner-lands`, and `paths.control` is `human` |
    | `tickets-approved` | no ticket or goal changes, and no ticket a runner creates is filed, without a human approval of that file: a `std:approval@1`, or the human's merge of the ticket's PR, or the request PR, carrying it | `no-runner-lands`; `paths.tickets` is `approval`; `tickets.created` is `proposed`; and `attestations` admits only `human` for `std:approval@1` |
    | `independent-review` | a runner's change the merge runner lands has two reviews from domains other than its writers' and each other's, runs compared as R-BTN-180 says — a labelled run of a credential `domains.per_run` lists counting as its own domain only as far as the deployment keeps that credential's runs apart (§12.8); what the human merges by hand, the human has reviewed | `no-runner-lands`; `merge.reviews.count` ≥ 2; and `attestations` admits only `baton` for `std:review@1`, `std:wrote@1` and `std:ran@1` |
    | `human-gates` | no owner's agent session, and no delegated key, changes membership, roles or the policy, and every human approval is made on a hardware key no session can drive | `approvers.members`, `approvers.roles` and `approvers.policy` are human-only lists, and the repository's `human_key` is `hardware` |
    | `board-from-trusted` | nothing a trusted leg acts on comes from a runner's board post or from git verdicts | `no-runner-lands`; `inputs.board` excludes `machine`; and the `attestations` entries admit no `sync` writer for `std:arrival@1` or `std:decision@1`, and only `human` for `std:decision@1` (R-BTN-191) |

    Every guarantee holds against a compromised runner, within what its knobs' enforcers enforce
    and nothing §12.8's list excludes. Against an injected owner's agent, one holds only together
    with `human-gates`: an `owner` approver can grant a trusted role or a member, which no other
    guarantee constrains; and under `human_key: any` a human-only list is a promise about key
    custody, which is why `protected` does not claim `human-gates`. The `protected` preset holds all
    but `human-gates`, and `no-runner-lands`, with every guarantee that includes it, only once the
    protection checker has reported a match; `protected-hardware` holds all six on the same
    condition.
  - **Floors.** The policy's `floors` knob lists guarantees by name. Setting it is a policy change
    like any other, by `approvers.policy`, refused when a listed guarantee's policy conditions
    are not met by the document after the change. From then on Baton refuses any policy change after which a guarantee the
    list **in force before the change** names would not be met, `floor-violated` naming the
    guarantee, whoever asks: a version that drops a guarantee from `floors` and breaks it is
    refused, so a shortening is its own version, made while the guarantee still holds, and a
    preset's apply never touches the list. A consumer reads the `floors` list and the computed
    `guarantees`, never a floor's name alone.
    - Floors bind policy changes and are judged on the policy alone: the protection report is not
      a policy condition, so a lapsed or failed report never refuses a change. It breaks
      `no-runner-lands` all the same: Baton raises `baton.unprotected` and stops the repository
      (below), and every trusted runner stops acting on it, except the protection checker, which
      keeps checking, until it reports a match.
  - **A broken floor stops the repository, in Baton.** While a guarantee `floors` names is broken,
    Baton offers and accepts no claim or advance on any ticket that reaches the repository, homed
    there or naming it in `repos:` (rule `floor`, `floor-broken`), and sends every running claim on
    such a ticket a `release` with reason `floor`, which ends it `released:floor`. The protection
    checker is exempt. Baton enforces this itself, never by asking runners: an ordinary `runner`
    grant shares its sandbox with the code it builds, so a check it promised to make proves nothing.
  - **The read.** `GET /v1/repositories/{repository}/policy` answers owners, administrators and
    keys granted on the repository with `{repository, version, hash, policy, guarantees: {<name>:
    held | broken}, floors, at}`. A trusted runner reads it over its own authenticated connection
    and acts on it as Baton's: Baton's server is trusted (§12.8), so the read is signed by nothing
    and pinned by nobody, and a deployment's audit reads the same route with a key of its own.
- **R-BTN-180 (roles, domains and protection).**
  - **Every grant has a role and a domain.** The role is `runner` or `trusted-runner` (R-BTN-182),
    and a `trusted-runner` grant may further be marked the repository's protection checker
    (`checker`, below); the domain is a label naming the host or VM the grant's process runs in (1–128 characters of
    `[A-Za-z0-9_.:-]`; no `/`). The role, the mark
    and that label are set by the `approvers.roles` approver (`PUT
    /v1/owner/{repository}/grants/{fingerprint}/role`), `trusted-runner` refused for an API-key
    credential (`invalid-params`; a trusted runner signs, R-BTN-159); a grant nobody marked is a
    `runner` with no domain. Baton compares domains as labels and verifies nothing about them:
    that a label names one host, and that a trusted runner's host runs no other grant, is the
    deployment's to make true (§12.8).
  - **Per-run domains.** The policy's `domains.per_run` (an `approvers.policy` change, checked
    against the floors like any other) lists credentials — by key fingerprint — whose runs each
    carry a label of their own:
    - **Who may be listed.** Only a credential whose grant on the repository is a `runner` with a
      non-null domain set by an admitted approver; a policy change listing any other — a
      `trusted-runner` or checker grant, a grant with no domain, an unknown, revoked or suspended
      key — is refused `invalid-params`; revoking or suspending a listed key un-lists it in the same
      transaction; and so is a role change that would make a listed
      credential's grant `trusted-runner`, a checker or domainless. Clearing a domain (*Making
      `approvers.roles` human-only*, above) un-lists the credential in the same transaction.
    - **The label.** A listed credential's runner reports a `run_label` (1–128 characters of
      `[A-Za-z0-9_.:-]`) on the `advance` that starts each run, and only there — never through a
      leg's channel (R-BTN-106). Baton refuses an `advance` starting a run without one, a label
      from a credential not listed, and a label the same credential reported for any earlier run
      on the tenant (`invalid-params`, rules `label-missing`, `label-unlisted`, `label-reused`),
      atomically (`run_labels`, §13). A refresh (R-BTN-123) keeps its run's label; an `advance` that starts no run and carries one is
      refused `label-unexpected`. A run's label is fixed when it starts: listing or un-listing later
      changes no run already recorded. An adopted run carries no label.
    - **How runs compare.** A run is attributed the domain its grant had when the run started
      (`claim_legs.domain`) and its label, if any, each recorded as its own field; its attestations
      carry both (R-BTN-181). A label counts only in a comparison made under the policy of a
      repository whose `domains.per_run` listed the run's credential when the run started; under
      any other repository's policy — another `repos:` entry of a multi-repository ticket among
      them — the run counts as unlabelled. Two runs count as **different domains** when their
      domains differ and their runner keys differ, or when both carry counting labels that differ.
      Every other pair counts as the same: a labelled run and any unlabelled run on one domain,
      whichever credential made either; and two runs by one runner key, whatever domain its grant
      had at each. So no grant becomes independent of itself by being listed, un-listed or
      re-domained, and no other key with the same domain becomes independent of a listed one
      (R-BTN-183).
    - Baton knows nothing of what a label names.
  - **Refs.** A runner or mirror updates only the ref classes `refs.*` admits it to, and a runner
    admitted to no ref outside `branch_pattern` updates only refs matching it. `refs/baton/*` is
    open to every writer, since GitHub cannot restrict it, and Baton reads nothing from it that a
    trusted leg acts on; `baton-legs/*` is open to `runner`, `trusted-runner` and `human`
    (R-BTN-190). The forge enforces this; Baton states it. Baton refuses a policy whose writes
    could never land: one whose `outbox.git` admits a role that `refs.default_branch` (under
    `tickets.created: filed`) or `refs.other` (under `proposed`) excludes, and one whose
    `refs.default_branch` excludes `runner` while `tickets.created` is `filed`, since a runner
    then files tickets nowhere (R-BTN-161, R-BTN-165).
  - **`baton repo protect --print <forge>`** prints, from the policy's `refs.*` and
    `paths.control`, the forge setting that enforces them — and, where the owners' `checks` names a
    course, the required status check by name and by the instance's `check_app_id` (R-BTN-115,
    read with the policy) — and **`--check`** reads it back, not matching while the required check
    names another App:
    - GitHub: an organisation (a personal account cannot name a person as a bypass actor). Rulesets
      on branches and tags whose only bypass actors are the identities the policy admits: the
      trusted runners' dedicated App (contents and pull-requests write, no Administration) and a
      team whose only member is the human-only identity; never the GitHub Actions App, a role, or
      Dependabot. Rulesets cover branches and tags only, so `refs/baton/*` cannot be restricted on
      GitHub. `--check` reads the rulesets and their `bypass_actors`, environments, their reviewers
      and deployment policies. GitHub returns `bypass_actors` only to a caller with write access to
      the ruleset, so on GitHub the check needs a credential that could also rewrite it; only the
      protection checker holds it, and no merge runner does. Whether a narrower App permission
      suffices is to be verified when B-140 is built. A change between runs is detected by
      comparing each run's reading with the last, not from an audit log, which GitHub offers only
      on Enterprise Cloud;
    - GitLab: protected branches and tags. On GitLab Free, where only roles may push, the trusted
      runner pushes with a deploy key and never holds Maintainer;
    - Gitea and Forgejo: protected branches and tags with a whitelist;
    - plain git: a `pre-receive` hook on a server that knows the pusher's identity (gitolite, or
      `authorized_keys` with `environment=`), with no runner able to write the repository's files;
      the hook keeps a pusher log. Never a client-side hook.

    `--check` does not match while a `refs.*` class the forge cannot restrict excludes any
    writer.
  - **Only the protection checker's report counts.** The **protection checker** is a
    `trusted-runner` grant that the `approvers.roles` approver marks as the repository's checker.
    It runs as a process in a domain of its own, never as a workflow and never beside a merge
    runner, holds the credential `--check` needs and no merge credential, and claims no leg. What
    Baton can check, it does: a marked grant is offered no leg and admitted to no `outbox` class,
    and Baton refuses to mark a grant whose domain is null or whose domain another grant of the repository carries,
    that has claimed a trusted leg, or that delivers a class (`invalid-params`); the rest is the
    deployment's (§12.8). It runs `--check` at least hourly and reports `{matched, reading_hash}`
    with its heartbeat's `protection`, which Baton keeps as the repository's last report
    (`repositories.protection_json`, §13). Only its reports feed `no-runner-lands`; clearing the
    mark voids the last report, so `no-runner-lands` is broken until a marked checker reports. The sync and other trusted runners may
    run the check too; their readings only log a `discrepancy` (R-BTN-85). A report that does not
    match, or differs from the previous reading, raises `baton.unprotected`, a `notify` condition
    closed by a matching report.
  - **Nothing requires a runner the refs exclude to write the default branch.** Claims, status and
    course history are Baton's (R3-1266, B-120). Where `refs.default_branch` excludes `runner`:
    - under `merge.trusted`, no course commits to the default branch and `merge` legs are trusted
      legs (R-BTN-182). The standard courses commit only on the ticket's branch under every policy
      (R-BTN-131);
    - under `tickets.created: proposed`, nothing writes a ticket file on the default branch
      directly. A ticket a runner's action would create (a condition's handler ticket, R-BTN-161; a
      call leg's child, R-BTN-165; a supersession's replacement;
      not a ticket file a leg writes on its own ticket's branch, which the human's merge of that
      PR files, R-BTN-131),
      and the outbox's git kind (a withdrawal, R-BTN-171), is
      **proposed, not filed**: Baton queues an outbox entry for it, and a trusted-runner deliverer
      writes it on a branch `baton/proposed/<ticket>` from the entry's fields or the creating leg's
      typed output, through the CLI's own templates (R-BTN-171), marks the entry `delivered` with
      that commit, and Baton holds only its filter fields (R-BTN-33). It is not claimable, no leg
      reads its body, and the entry is not `confirmed`, until its file lands. Such an entry is late
      only when it is not delivered within 24 hours;
    - **a proposal lands by a proposal merge** (R-BTN-183): the merge runner merges
      `baton/proposed/<ticket>` when every commit on it since the merge base is a deliverer's
      template write for that ticket's entries, touching only the paths they name, and a
      `std:approval@1` whose subject is that ticket at that commit covers exactly those paths and
      blobs. `merge.reviews`, `merge.checks` and continuity do not apply to it; one approval covers
      one proposal;
    - `baton ticket request` (R-BTN-131), whose push the forge refuses as protected, opens a PR instead, deciding by the forge's answer and never by reading the policy;
    - where `refs.default_branch` excludes `mirror`, the mirror (§16) writes nothing to the
      default branch; its notes are Baton's.
  - **Secrets and privileged jobs.** Runners push some ref of the repository under every preset
    (their `branch_pattern` branches at least), and a workflow file pushed to one runs with the
    repository's secrets, so no repository-level secrets anywhere: secrets live in environments
    limited to the default branch. A secret limited to the default branch is only as safe as the least-protected path
    its workflows execute, so every such path is protected (R-BTN-184). Privileged jobs restore no
    Actions cache, run with a read-only default `GITHUB_TOKEN`, and install nothing from the
    repository's lockfile or package-manager configuration. Environments that deploy or release
    require the human-only identity as reviewer; the trusted runners' and the sync's environments
    are limited to the default branch, without reviewers. A release is the signed tag and the
    published package's provenance, never the forge's release object, which any `write` role can
    edit.
  - **The everyday forge identity** the owner's agent sessions use holds no admin, maintain or
    organisation-owner role and no bypass on a repository with any human-only approver list (R-BTN-185).
- **R-BTN-181 (attestations: typed statements about work or about a resource).** A typed
  statement Baton stores, which a leg may require: a review, a check run, a human's approval, a
  provider's remaining quota. Attestations differ only in their subject and their writer; whether
  one gates a leg is the requirement's choice, never the attestation's.
  - **Shape:** `{id, type, subject, value, writer, nonce, lapses_at?, at, revoked_at?}`. `type` is
    a schema id from the shared registry (R-BTN-108). `nonce` is the writer's idempotency key: a
    repeat with the same `(writer, type, subject, nonce)` returns the first `id` and writes
    nothing. A reading has none: it supersedes per `(instance, source, kind)` (R-BTN-76), so a
    repeat is harmless. `value` is validated by the type's schema
    (at most 4 KB). An attestation is in force until `lapses_at`, if set, or until it is revoked
    or superseded. `subject` is one of:
    - **work**: the repository and the ticket, and optionally a commit or a ref, and for a type
      a trusted leg whose action is not idempotent requires, the run (`claim_legs.run`, below). For a
      trusted leg it comes from values Baton holds (the claim's ticket, the head the sync read),
      never from a runner's output;
    - **a resource instance** (R-BTN-76). An attestation about an instance is a **reading**.
  - **Writers.** Baton records an attestation's writer from the credential that posted it:
    - `human`: a `human_only` key (R-BTN-185);
    - `owner`: any owner key or owner session, an owner's agent included;
    - `baton`: Baton itself, from events it verified;
    - `instrument`: an instrument key; `runner`: a runner credential, a trusted runner's included;
      `admin`: an administrator;
    - `sync` (R-BTN-191).

    Any of them is also `service:<fingerprint>` for its own key, so a requirement can name one key
    (a trusted runner, a check-runner, one instrument). Work is attested by `human`, `owner`,
    `service`, `baton`, `runner` and `sync` writers on the repository; a resource instance by the
    writers R-BTN-76's *Who reports* names.
  - **Authenticated by the request.** An attestation is a statement by the credential that posted
    it (R-BTN-13, R-BTN-159; the sync's by its board post's authentication, R-BTN-191), and Baton
    records that credential as its writer; it carries no signature of its own, since nothing
    outside Baton verifies one (§12.8). An attestation counts only while its writer's key, and
    for a `baton` attestation the attested runner key, is unrevoked. A reading is no exception
    (R-BTN-76).
  - **Any surface.** `POST /v1/repositories/{repository}/attestations` (`baton attestation add`,
    `baton decision answer`, the dashboard; R-BTN-127) takes an attestation about work, and
    R-BTN-76's routes take readings; whether one is accepted depends on the credential alone
    (R-BTN-186). A delegated key writes none (R-BTN-130), and is never `human`.
    `DELETE …/attestations/{id}` (`baton attestation revoke`) revokes one, a human gate for
    `human` ones.
  - **Supersession.** A new attestation supersedes an earlier one only when type, subject, writer
    and **attested key** are the same; the attested key is the writer's key, except for a `baton`
    attestation, whose attested key is the runner key it is about — with the run's label, for a
    labelled run (R-BTN-180). So two runners' reviews at one head coexist, and so do one listed
    key's reviews under two labels, a later `std:ran@1` by one domain never erases another's, and each instrument
    keeps its own latest reading (R-BTN-76). The one exception is the sync's: its attestations
    supersede by type and subject whichever sync credential posted them (R-BTN-191).
  - **Bound by subject, not consumed.** An attestation gates every action on exactly its subject:
    a `std:approval@1` names the paths and blobs it approves at a commit, and the merge runner
    merges exactly that head (R-BTN-183), so one approval cannot land two merges and no
    use-once bookkeeping is kept. The rule holds because a trusted leg's action is idempotent on
    its subject: a merge changes the head it names, a deletion removes the branch. A trusted leg
    whose action is not — a sensitive API call — names its run in the attestation's subject
    (`{ticket, head, run}`), so a re-run after a retry or a release needs a new attestation.
  - **A prerequisite kind** (R-BTN-120): a leg's `requires.attestations: [{type, subject, writers,
    where?, count?, distinct?, binds?, missing?}]`.
    - `subject` is `work` (the leg's ticket, optionally at its `head`, and `run: this` for a type
      bound to the run) or `instance: <resource>` (the repository's usable instances of it, R-BTN-76).
    - `writers`, optional, narrows the writer classes and `service:<fingerprint>` keys whose
      attestations count. It never widens them: what counts is the policy's `attestations` or
      `readings` entry for the type (R-BTN-188), intersected with `writers` when given.
    - `where` is a list of tests `{path, op, value | leg_input}` over the value, `op` one of `eq`,
      `in`, `glob`, `superset-of`, `gte`, `lte`; `count` (default 1) attestations must hold, with
      `distinct` naming a field they must differ on.
    - `binds` is `gate` (the default) or `advice`. `missing` is `block` (the default for `gate`)
      or `allow` (the default for `advice`): whether no attestation in force, lapsed, revoked or,
      for `requires.resources`, `unknown` (R-BTN-76), blocks.
    - Unmet, it is an `attestation` block, `why` one of `missing`, `other-subject`,
      `writer-not-allowed`, `lapsed`, `revoked`, `failed-where`. A gate's block refuses
      a claim and an advance (rule 1); an advice block is advice, as a `resource` one is (R-BTN-75).
    - `requires.resources` (R-BTN-76) is the short form of an `instance` requirement on
      availability, and takes `binds`, `missing` and `writers` with the defaults `advice` and
      `allow`.
    - The validator refuses a `trusted: true` leg with a requirement that binds as `advice` or
      takes `missing: allow`.
  - **Whose attestations count is the policy's to say** (R-BTN-188), never the course's: a course
    file is only as protected as `paths.control` makes it, and the policy is Baton state. Baton
    admits, for a type `merge` or a trusted leg acts on, only `human`, `baton`, and
    `service:<fingerprint>` keys the owner names — a trusted runner's, a check-runner's, an
    instrument's — never an owner key or an ordinary runner grant; and whose `readings` entry, for
    a resource a trusted leg requires, admits only `instrument`, `admin` and such `service:` keys.
    It checks this both ways: a policy change is refused when it would admit
    another writer for a type a current course's trusted leg requires, and a course whose trusted
    leg requires a type the policy admits another writer for is refused at the snapshot that
    posts it, the previous course version staying in force. Trusted legs' requirements other than
    `merge`'s stay in their course files, held by this check.
  - **Standard types:**
    - `std:wrote@1` (writer `baton`): a writing leg's reported commit range `start..head`, its
      domain, its run's label if any (R-BTN-180) and its runner key;
    - `std:ran@1` (writer `baton`): a leg ran the branch's code at `head` in its domain, with its
      run's label if any (every
      writing leg, and any leg its course does not mark `reads_only: true`);
    - `std:review@1` (writer `baton`): a review leg the course marks `approves: true` and
      `reads_only: true` ended `approve` at `head`, with its domain and its run's label if any;
    - `std:checks@1` (writer `service:<a check-runner's key>`, R-BTN-114): the course's check
      commands, from protected course data, passed at `head` in a sandbox holding no credential;
      optional, since the forge's own check runs from the protected default branch suffice for
      `merge.checks` (R-BTN-183);
    - `std:approval@1` (writer `human`): the owner approved `head` with `value {paths, blobs,
      view}`: the protected paths changed, their blob ids, and the digest of the computed view;
    - `std:branch-deletion@1`, and others: the same shape, for other trusted legs.
  - **Read from git by the sync, or by a trusted runner.** An attestation that reports what git or
    the forge shows is the sync's (R-BTN-191), counting only where the policy admits `sync` for its
    type, or the fact reader's (R-BTN-192), a trusted runner's `service:` key the policy names. A
    person leg (R-BTN-116) a trusted leg acts on is answered by a `human` attestation.
  - **Baton's own state** (an exception to R-BTN-35, as course history is, B-120). Attestations about work are exported with the owner state (R-BTN-88);
    an import drops every one of them, and in-flight work re-attests by re-running its writing and
    review legs. Lost attestations fail closed. Readings are kept and exported as R-BTN-76 and
    R-BTN-88 say.
- **R-BTN-191 (every statement Baton receives about the work is an attestation).** Baton takes
  facts about work in one way: as attestations (R-BTN-181), whoever states them. What else
  reaches it is a **command**: a request to change Baton's own state (a claim, an `advance` or
  end, a heartbeat, an owner's or administrator's action), which Baton accepts or refuses by its
  gates; and what leaves it is an outbox entry (R-BTN-171), a workflow dispatch (R-BTN-94) or the
  reply to a command or a read. A reading is one about a resource instance (R-BTN-76); a review,
  a check run or an approval is one about work; and so is everything the sync reads from git and
  the forge, every person's answer and every deliverer's delivery. They differ only in their
  writer, and the policy's `attestations` entry for each type (R-BTN-188) decides whose count.
  - **One writer class** joins R-BTN-181's: `sync`, the credential that posted the board (a sync
    key, the registered CI identity, or a machine key, R-BTN-93), for what it read from git and the
    forge in one run. A deliverer's delivery is the writer `runner` (R-BTN-171).
  - **The sync's attestations** ride in the board post (§4.4, `attestations`), each about work (the
    ticket, optionally at a commit or ref), each carrying the run's `observation`:

    | Type | Value | Read by |
    |---|---|---|
    | `std:git.readiness@1` | `{at: {station, path_len}, next: [{leg, state: ready \| waiting, waiting_on?, needs?, course}]}`: the legs leaving `at`, as the station function computed them | R-BTN-70 |
    | `std:git.evidence@1` | `{claim, sha? , url?, found}`: whether git or the forge shows the evidence an unconfirmed end named | R-BTN-10 |
    | `std:arrival@1` | `{leg, reached, next?, ref}`: a fact arrival, `ref` naming the fact | R-BTN-39 |
    | `std:git.implied@1` | `{station}`: where the facts place the ticket, if the course says | R-BTN-39 |
    | `std:decision@1` | a person's answer the ticket shows (R-BTN-116) | R-BTN-116 |
    | `std:git.output@1` | `{leg, run, name, uri, digest?, leg_version?, ref, claim_nonce}`: an output a closing marker lists | R-BTN-82 |
    | `std:git.commit@1` | `{repository, sha}`: evidence an end named, as git shows it | R-BTN-10 |

    A run's attestations are accepted or refused with its post, in its transaction, and replace
    the previous run's of the same type and subject (R-BTN-181's supersession). So Baton never
    judges a ticket from facts of two runs: readiness, arrivals and evidence are always one
    observation's. The post's own authentication (R-BTN-93) is their authentication.
  - **A command may carry an attestation.** An `advance` or end moves the lease (the command)
    and carries the holder's `std:arrival@1` for the leg it finishes (the statement), authenticated
    by the request (R-BTN-83). A runner's arrival and the sync's fact arrival are one type, differing
    only in writer: the holder's counts for the leg its claim runs, the sync's or the fact reader's for a leg
    that declares `arrives` (R-BTN-192); any other is kept as evidence and recorded `arrival-unapplied` (R-BTN-39).
  - **A person's answer** is always a `std:decision@1` attestation. The person writes it (`baton
    decision answer`, R-BTN-127, or the dashboard) or the sync attests the answer the ticket shows; which counts is
    the policy's: an entry admitting `sync` is an answer in git, one admitting only `human` or
    `owner` is an answer in Baton (R-BTN-116).
  - **A deliverer's delivery** is a `std:effect@1` attestation (`{kind, ref, at}`) about the
    entry's ticket, its subject naming the outbox entry, by the runner that delivered it. It moves
    the entry to `delivered` (R-BTN-171); the entry is confirmed by the sync's later attestation
    that git or the forge shows the effect.
  - **What a policy admits**, per type (R-BTN-188's `attestations`). Every preset admits
    `runner` for `std:arrival@1` by the claim's holder, for its own leg only, and `sync` for the
    `std:git.*` types. `cooperative` admits `sync` for `std:arrival@1` and `std:decision@1` too;
    `protected` does not: there a fact arrival counts only from the fact reader (R-BTN-192), and a
    person's answer only from a `human` key. That is what `board-from-trusted`
    checks (R-BTN-189). A trusted leg acts only on attestations it re-checks itself (R-BTN-182),
    never on the arrival that queued it.
  - **Superseded per writer class.** The sync's attestations supersede by type and subject
    whichever credential posted them (a sync key, the CI identity or a machine key, R-BTN-62,
    R-BTN-93), so a repository's posting credentials never leave two runs' facts side by side;
    where `inputs.board` admits `machine`, a granted machine key's post therefore replaces the
    CI sync's facts as fully as the CI sync's replaces its.
- **R-BTN-192 (the fact reader: forge facts a trusted runner attests, with no course code).**
  Where the policy admits no `sync` writer for `std:arrival@1` (R-BTN-191), a fact leg's arrival
  comes from the **fact reader**: a mode of the home's merge runner (R-BTN-182, B-140) that reads
  the forge through the CLI's own fact adapters (R-BTN-96) and runs no repository code.
  - **The kinds**, a closed set a fact leg names (`arrives: {fact: <kind>}`, R-BTN-69), each read
    for the ticket's PRs as R-BTN-131 maps them:

    | Kind | The fact | `ref` |
    |---|---|---|
    | `pr-merged` | a ticket's PR merged by a merge no `merge` leg of the ticket reported | the merge commit |
    | `pr-verdict` | a verdict on the PR's head that no claim of the ticket wrote: a pusher's (R-BTN-139) where the policy admits `sync` for `std:arrival@1`; where it does not, the human-only identity's alone, the forge user the policy's `human_identity` names (R-BTN-188, R-BTN-185), since runners push their own branches | the review's or comment's URL |
    | `pr-opened` | a PR on the ticket's branch pattern, open | the PR's URL |
    | `pr-pushed` | a push to the ticket's PR after the leg began leaving the ticket's station | the head sha |

  - **What it reads.** Baton tells it which tickets wait: `GET /v1/repositories/{repository}/
    fact-legs`, every live ticket with a leg leaving its station that declares `arrives`, with the
    station, `path_len`, the leg, its kind and the instant the leg began waiting. It reads only
    those, and only the kinds they name.
  - **When.** Each minute while that list is not empty, and at once on a doorbell ring `facts`
    (R-BTN-91) that Baton sends when a ticket joins the list or a forge notification arrives for
    a repository with one (R-BTN-73).
  - **What it writes.** An `std:arrival@1` per fact found, its `ref` as the table says, as its
    `service:` key, through `POST /v1/repositories/{repository}/attestations` (R-BTN-181); R-BTN-39
    applies it. The key counts only once the owner names it in the policy's `attestations` entry
    for `std:arrival@1`, as a check-runner's key is named for `std:checks@1` (R-BTN-188).
  - **None named.** A repository whose policy admits no `sync` and no named fact reader for
    `std:arrival@1`, while its registry lists a course with a fact leg, raises
    `baton.fact-reader-missing`, a `notify` condition closed when a key is named; its fact legs
    then arrive only by adopt (R-BTN-39).
  - Under `cooperative` the sync's station function may attest the same kinds, and any fact a
    course reads, as `sync`; the fact reader is optional there.
- **R-BTN-182 (trusted runners).** A grant role (R-BTN-180) that claims only legs its course
  marks `trusted: true` (`merge`, branch deletion, sensitive API calls, each idempotent on its attestation's subject, R-BTN-181) and holds the only
  non-human credential able to perform that leg's action. No other runner is offered a trusted leg
  or may claim, advance or end one (rule `trusted`), and neither is a grant marked `checker`
  (R-BTN-180) or a runner that delivers `forge-check` (R-BTN-115).
  - **It runs no repository code but a trusted leg's override**, which it runs through its own
    means as any leg's code (below), delivering the outbox included (R-BTN-171). It runs a CLI release installed by tarball integrity with the
    release's own `npm-shrinkwrap.json`, so every dependency is pinned too, outside any checkout,
    with no user or project package configuration; and git plumbing.
  - **It re-checks at the moment it acts**, against Baton's record: every attestation it relies on
    is read from Baton over its authenticated connection, its writer's key unrevoked and admitted
    by the policy in force, and its subject compared with the exact object acted on — the head,
    the paths, the blobs. It trusts Baton for what Baton recorded (§12.8) and trusts no runner's
    board post, webhook or runner's output for what it acts on (R-BTN-187); the head the sync read
    it re-reads from git before acting (R-BTN-183).
  - **Its credential is human-level for what it may do.** It runs as a workflow on the default
    branch or as a process, in a domain shared with no other grant; that no agent session runs
    there is the deployment's to make true (§12.8).
  - **A course's `legs/<leg>.run.mjs` for a trusted leg may only add refusals.** It runs as any
    leg's code does, by the runner's own means — Baton names none for a trusted leg rather than
    another — with the computed diff as its only input, and returns `{refuse, reasons}`, `reasons`
    from a closed list with path ids. The CLI applies R-BTN-183 afterwards, whatever it returns.
    That the override cannot reach the trusted runner's credential is the deployment's (§12.8).
- **R-BTN-183 (what the merge runner merges).** At the PR's exact head `H`, under the policy's
  `merge` and `paths` (R-BTN-188), except a proposal merge, which R-BTN-180 defines alone:
  - **A domain that runs a branch's code is one of its writers.** Every `std:wrote@1` and `std:ran@1`
    domain of `H`'s chain is a writer domain. A reviewer never runs the branch's code: a review leg is
    `reads_only: true`, reads the diff and the files as data, loads its agent configuration from the
    default branch and never from the branch, and runs no hook, install, build or test; tests run
    only in a check-runner's sandbox (R-BTN-114) or the forge's workflows.
  - **Baton records this; the deployment makes it true.** Baton cannot observe what a leg ran:
    `std:ran@1` follows from the course's declarations. A deployment relying on independent review
    must therefore (a) run review legs in an environment with no command execution and no
    configuration from the branch, and (b) reset a domain to a clean state after any leg that
    ran a branch's code, before it serves another ticket, since taint is tracked per ticket while a
    domain persists. These are the deployment's, not the policy's (§12.8); Fieldhouse does both. Baton's part is the runner's harness: a
    `reads_only` leg starts its agent with no `--auto` or permission bypass and no configuration
    from the branch (B-141). The courses that run their reviews that way are the deployment's
    (R-BTN-131).
  - **Continuity.** A writing claim reports its start head at claim, which must be the last
    attested head (or the merge base for the first leg). The CLI refuses to build on any other tip
    and raises `baton.foreign-commit`. At `advance` the leg reports `start..head` from the objects it
    pushed and verifies the remote equals them; its own intermediate pushes inside that range are
    its own. Commits reachable from the default branch (a merge of main into the branch) are not
    part of any range. A rebase replaces the range: the leg that rebases reports the new one. Who
    wrote a commit is what the chain of ranges says; commits carry no signature Baton requires
    (the owner, 2026-11-01, "Remove until designed": a host-side signer is not designed, and a
    runner's own key would sign whatever a hostile leg on its host wrote). Review rounds go to the
    PR conversation or, on a `git` repository, to the ticket's leg-state branch, never to the work
    branch (R-BTN-190, B-101), so a reviewer never becomes a writer.
  - **Independent review.** `merge.reviews.count` `std:review@1` at `H`, each from a domain other
    than every writer domain of `H` and from a review claim that started at `H`, no two from one
    domain, runs compared as R-BTN-180's *How runs compare* says. A chain any of whose
    `std:wrote@1` or `std:ran@1` carries a null domain never merges while `merge.reviews.count` ≥ 1:
    a writer nobody labelled cannot be told from its reviewers. A grant's domain is set by the
    `approvers.roles` approver, and a run's label by its runner under `domains.per_run` (R-BTN-180).
  - **Checks**, under `merge.checks: required`. Check runs whose workflow file is on the protected
    default branch with the same blob as at merge time, concluded `success` at `H` (never `neutral` or `skipped`) ("Forge checks suffice",
    the owner, 2026-11-01); or a `std:checks@1` at `H` where the owner named its writer
    (R-BTN-181, R-BTN-114). Commit statuses are never read. Checks show that the change's own tests
    pass; they are not a security gate.
  - **Paths.** The changed paths are `git diff-tree -r -z --no-renames --name-only` from the default
    branch's tip to the merge result, plus each `merge-base --all` diff. A symlink or submodule entry
    (modes 120000, 160000) or a `.gitmodules` change anywhere is refused. Paths are matched as `p`
    and `p/`, case-folded and NFC-normalised, against the protected paths.
  - **Protected paths.** Under `paths.control: human`, a control path never merges here; under
    `trusted-runner`, it merges only with a `std:approval@1` as a ticket path does (R-BTN-184).
    Under `paths.tickets: approval`, a ticket or goal path merges only with a `std:approval@1` at
    `H` whose `paths` and `blobs` cover every protected path changed,
    and whose blobs equal those paths' blobs in the merge result; the own-progress exception aside.
    Main moving does not void an approval unless it changes an approved path.
  - **How.** Squash or merge at exactly `H`, with the base pinned too (a compare-and-swap push of
    the merge result onto the main tip it was computed from), and a commit message the merge runner
    writes itself, carrying no trailer from the branch. A branch that moved since an attestation was
    made is refused, and the ticket returns to the leg the course names.
  - **Leg state** (R-BTN-190). A work branch whose merge result, or any commit in the ticket's
    ranges, holds an entry folding to `.baton-legs` is refused.
  - **Foreign commits.** A commit on a ticket's branch that no claim of that ticket reported is found
    by the trusted runner from git, not from webhooks. It resets the
    branch to the last attested head and raises `baton.foreign-commit`, an `owner` resolution, not a
    human gate, so a cheap push cannot cost a hardware-key ceremony.
  - **Source pins** (R-BTN-134) are accepted only at a commit on the source's first-parent history or
    a release tag.
- **R-BTN-184 (protected paths).** The policy's `paths.protected` (R-BTN-188), with a floor no
  course or owner removes. Baton computes what it can and fails closed on the rest:
  - computed: `.baton/**`; every path `.baton/baton.json` lists in `imports`; the items glob and goal
    glob the ticket source declares in `baton.json`; `.github/workflows/**`, `.github/actions/**`
    and every local path a workflow `uses`; `.github/CODEOWNERS`; agent configuration for each
    supported harness (Claude Code: `.claude/**`, `**/CLAUDE.md`, `.mcp.json`; opencode:
    `opencode.json`, `.opencode/**`; and `**/AGENTS.md`); package-manager and environment
    configuration (`.npmrc`, `.yarnrc*`, `.envrc`);
  - declared by the owner: authority documents as whole files (the context corpus, `lessons`, the
    spec), and what deploying or releasing workflows execute. A repository whose workflow uses a
    secret in a deploy or release environment is protected `**` until the owner narrows it; `baton`
    is `**`.
  Two classes:
  - **Control paths** (all but tickets and goals): landed as `paths.control` says. Under `human`
    they are never merged by a trusted runner: the leg ends at `human-merge`, showing the human the computed view of `H` (B-133): the chain, the reviews, the
    checks and the diff. A human lands it; the fact reader recognises the human's merge by reading
    the forge (the merge's actor equal to the policy's `human_identity`, R-BTN-188, or the pusher
    log) and attests it as the `pr-merged` arrival of `merged-by-hand`, which leaves `human-merge`
    (R-BTN-131, R-BTN-192); Baton records a `pr-merged` whose merge commit is not the presented
    `H` as a discrepancy (R-BTN-85), the arrival applied all the same. Under `trusted-runner`, the
    merge runner merges them with a `std:approval@1`; under `any`, they merge as any path does.
  - **Tickets and goals:** under `paths.tickets: approval`, merged by the merge runner with a
    `std:approval@1` (R-BTN-183), or by the human's own merge of a ticket's PR or a request PR
    (R-BTN-131).
  - **A leg's own progress** needs no approval: a claim's branch may append to its own ticket file,
    at the exact path Baton's claim names, when the change is bytes appended at the end of a file
    whose base ends in LF, compared as blobs without rename detection, with no mode change, after the
    file's last line `## Status` (LF, outside code fences, present at the merge base). A file without
    one takes no progress. Each entry is one line, `- <UTC time> <leg> <claim nonce>: <text>`, the leg
    and nonce equal to the claim's and the time within its span; the text at most 300 bytes of
    letters, digits, spaces and `.,;:-'()?!`, no URL; at most 20 entries per claim. Readers show these
    lines as the leg's data. Anything else in a ticket file is a ticket change. A done ticket's move
    to the archive, setting `status: done`, is a templated change the merge runner makes; a record
    course's ticket makes it on its own branch (R-BTN-131).
- **R-BTN-185 (human-only credentials).** A human gate — `std:approval@1`, revoking a `human`
  attestation, a human's merge, and every action whose approver list in the repository's policy
  is human-only (R-BTN-188) — is satisfied only by a credential no agent session holds and no agent can
  drive. A production deploy or release and a ruleset bypass are the forge's, held to the same
  human-only identity.
  - **The human-only key** is an SSH key registered `human_only`, used for nothing else, and kept
    where no agent session can use it: not in an agent session's environment or `ssh-agent`, not on a
    machine an agent drives. A tenant's first is a line of the host's `BATON_HUMAN_KEYS`
    configuration, as administrators are (R-BTN-57), never registered over the API; each later
    one is registered with a signature by an existing one (`baton human-key add`, R-BTN-127;
    `POST /v1/human-keys`), and any is
    revoked only with a `human_only` key. Baton refuses a revocation, and an instance switch to
    `hardware`, that would leave a repository with an approver list no live key can satisfy
    (R-BTN-188). How strongly a deployment enforces "no agent can use it" is
    its own policy, `human_key: any | hardware` (an instance setting, default `any`, which a
    repository's policy may raise for itself, R-BTN-188): `hardware`
    accepts only a hardware-backed key requiring PIN and touch (`verify-required`) whose FIDO
    attestation matches an allowlist of authenticators. Switching to `hardware` suspends every
    `human_only` key registered before the switch that does not meet it. Fieldhouse requires
    `hardware` (R-FH-3). Under `any` a human-only list is a custody promise, and no guarantee
    claims it as a human gate (`human-gates`, R-BTN-189).
  - **What is signed is shown first.** The CLI prints the canonical fields and the computed view
    before signing. Under `human_key: hardware`, it also requires a short code derived from them,
    typed on the machine the key is plugged into. The dashboard may only prepare an approval that the
    CLI signs; a WebAuthn assertion is a human gate only with an authenticator registered by a
    `human_only` signature, attested and allowlisted under `hardware`.
  - **Two forge identities.** The human-only identity administers every repository with a human-only
    approver list and is its only human bypass and reviewer; its token is in no agent session, and no agent tool drives the
    browser profile or desktop where it is signed in. The everyday identity the owner's agent
    sessions use has no administrative role (R-BTN-180).
  - **The owner's agent** is a principal (§12.1): an owner key not `human_only`. It acts as `owner`,
    never as `human`. A dashboard session minted by a `human_only` key is an owner's session
    (`owner`, R-BTN-181), never `human`: a human gate is opened by the key's own signature alone,
    so no session, and no OAuth approval by one, satisfies a human-only `approvers.*` list.
- **R-BTN-186 (authority by credential, not channel).** An action is available on every surface (the
  CLI, the API, the dashboard, MCP) to the principals its `callers` list (R-BTN-129), and to no other;
  a surface lacks an action only for a mechanical reason the registry names.
  - **A delegated key** (an MCP key, R-BTN-130) acts as an owner of its repository, never as
    `human`, for the actions listed at its minting, and may **tighten, and undo its own
    tightenings** (the owner, 2026-11-01): add a hold or a bar, stop a leg, cancel a ticket; and
    lift a hold it set, lift a bar it added. Resolving a condition is neither: a restart closes
    what Baton or a leg raised — ending a block or a hold another set, routing, or (`park` on
    `baton.stalled`) setting a hold under a reason the key's own test never matches — so it is
    neither a tightening the key could undo nor the undoing of its own, and stays the owner's
    (R-BTN-163). An expedite reorders
    and tightens nothing, so it stays the owner's; a cancel is undone by no one, its `cancel` leg
    running its course (R-BTN-168); a stopped leg needs no undoing, being claimable again at once
    (R-BTN-119). It never loosens what another credential set, never routes, adopts or answers a
    person's leg (an answer moves a ticket, R-BTN-116), never holds credential management, and
    never makes a change that loosens an R-BTN-66
    setting — lifting another's hold, removing or narrowing another's bar, `retry`,
    `pushers`, `code_repos`, `transcript_repos`, `artifact_buckets`, `leg_log_root`,
    `unblocked_trigger` (setting or changing it), `checks`, `check_runners`, `api_keys`, a
    grant's `sync` flag, any
    action an `approvers.*` list governs (a grant's role and domain among them), and any change to
    the repository policy or its floors (R-BTN-188, R-BTN-189). This is the one rule of what a
    delegated key may do; the registry's `delegated` marks derive from it and R-BTN-130 exposes
    over MCP exactly what they admit (R-BTN-129; B-124, B-156).
  - Tightening, such as adding a hold or a bar, is open to any owner credential, MCP keys
    included; loosening what another set is an `approvers.policy` approver's (R-BTN-188): an
    owner's under `[owner]`, a human's under a human-only list.
- **R-BTN-187 (what Baton trusts from a board post).** Where the policy's `inputs.board` excludes
  `machine` and its `attestations` entries admit no `sync` writer for `std:arrival@1` or
  `std:decision@1` (R-BTN-188, R-BTN-191):
  - what a protection depends on (changed paths, foreign commits, a human's merge) is read
    from git and the forge by trusted runners, never from a board post or a webhook delivery, which
    only triggers a sync (values 6);
  - stations a trusted leg acts on are reached from attestations by trusted writers, never from
    the sync's attestations of verdicts, trailers or comments read from git;
  - per-key limits on observation numbers, board posts and concurrent claims, so one key can freeze
    neither the board nor the leases.
- **R-BTN-134 holds in full** (B-139): a sourced course's home holds its entry and its overrides only;
  the sync refuses any other course file beside a `source`; runners load a sourced course's code only
  from the source, at a first-parent or release-tag commit, and decline a leg whose source they cannot
  verify.

### 12.9 A leg's scope *(B-134)*

A leg's scope is its ticket's home and `repos:` entries (R-BTN-140's `code_repos` once built;
until then every `repos:` entry that resolves to a forge path on the home's forge host, as
R-BTN-92 reads a short name under the home's owner), each by its whole forge path (a GitLab
subgroup's `group/sub/repo` names its repository by all three segments). The claim answer
carries it, and two halves report what a leg did outside it:

- **The runner's audit is a cooperative aid, not a control.** At each leg's end the runner reads
  the refs the leg's window moved in the home checkout — evidence the agent does not supply —
  after the leg's close and hand-off have run, so a push either of them made is the leg's too.
  A tracking ref that appeared or moved names a push only when the window's reflog entries say
  so (`update by push`): a fetch moves tracking refs the same way and names nothing, and a
  movement with no word of a push is not evidence of one. Each push is mapped to the repository
  its remote's URL points at (the whole forge path) and the actions outside the scope are
  reported with the claim, on the advance or end that finishes the leg (R-BTN-106) — at most
  sixteen actions, with the count of any beyond them, and the report's own shape-drops counted
  beside them, logged `scope-invalid`, never a refusal. The audit runs as the runner's OS user,
  inside the trust domain it audits, so a hostile leg can defeat it; it is detection for the
  honest and the mistaken, never a boundary. The report's shape carries two more kinds — `pr`
  (opened or commented on) and `egress` (a host reached) — whose sources the runner does not
  have: a forge reader and a VM egress log where Sand Pit exports one. They are deferred until
  those sources exist, and an `egress` action is judged against nothing meanwhile (no host
  scope is defined); the source that fills the shape arrives with the scope for it.
- **The scope cross-check is the control.** Every push delivery (R-BTN-73) whose pusher the
  pushed repository's owners named in their `worker_pushers` setting is checked against the
  claims open at the time — a claim still holding its ticket as rule 3 reads it (active, or
  completed and unconfirmed, or reaped fence-pending), so the delivery of an ordinary final
  push (R-BTN-8: the push precedes the end) that lands after the claim's `end()` still finds
  the claim that covers it: a push to a repository no open claim's scope covers records an
  `unclaimed-write` finding. The forge's word, not the agent's.
- **Findings.** Each `scope-exceeded` or `unclaimed-write` finding is one open row per shape,
  listed under Needs you (§14) until an owner resolves it — the acknowledgement that it was
  looked at, logged `scope-resolved`. With the owners' `scope_policy: hold`, a
  `scope-exceeded` finding also holds its ticket until an owner lifts the hold (R-BTN-12); an
  owner lifts it the way any hold is lifted. Both settings are R-BTN-66's: a hold that stops
  holding, and a cross-check that names fewer pushers, are loosening (R-BTN-186).
