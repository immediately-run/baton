---
title: "12. Security"
description: "BATON_SPEC — 12. Security."
---
## 12. Security *(partly built)*

- **Whose rules these are.** Every principal belongs to one tenant and authenticates only at
  that tenant's origin (R-BTN-137); the operator is not a principal (R-BTN-136).
- **Pushers are legitimate.** Whoever can push a registered repository's default branch is a
  legitimate user of it, and Baton does not fortify git (R-BTN-66). These rules keep people
  **without** push from gaining anything. No push changes the state Baton holds for authority:
  keys, grants, bars, holds, settings and the policy. What a push may move through the sync's
  attestations, each policy's `attestations` entry decides (R-BTN-188, R-BTN-191).
- **No existence oracle.** A refusal never tells a caller whether something outside its reach
  exists: an unheld action, an unknown target and a foreign one answer alike.

### 12.1 Principals

Each principal, the routes it uses, how it authenticates and what it may do. A row's powers are
stated once, in the rule it cites.

| Principal | Routes | Credential | May |
|---|---|---|---|
| Runner (machine key) | `/v1/runner/*` | SSH-signed (R-BTN-13) or API key (R-BTN-159), plus the runner secret (R-BTN-14) | heartbeat as its name; claim and act where it holds an active grant (R-BTN-58, R-BTN-146); post readings (R-BTN-101); ask blocks (R-BTN-75); accept or decline its grants, key alone (R-BTN-146); as a signed key, sync a granted repository (R-BTN-102) and deliver outbox entries where the policy admits `runner` (R-BTN-171) |
| Trusted runner | `/v1/runner/*` | SSH-signed, on a grant with the `trusted-runner` role (R-BTN-180) | heartbeat as its name; R-BTN-182; as the protection checker, report `protection` and nothing else (R-BTN-180) |
| Owner's agent | the owner's routes | an owner key not registered `human_only` | an owner's actions, as `owner`; never a `human` attestation or a human gate (R-BTN-185) |
| Check-runner | `/v1/runner/*`; `POST …/attestations` as a `service:` key the policy names | SSH-signed, plus the runner secret | heartbeat as its name; claim, advance and end check tickets; report activities and transcripts, write leg logs; where the policy's `attestations` names its key for `std:checks@1`, post that attestation (R-BTN-115); nothing else (R-BTN-114) |
| Board sync, mirror | `/v1/sync/*` | the repository's sync or mirror key, or a CI identity token (R-BTN-93, R-BTN-156) | sync: observation numbers and board posts; mirror: read events; both: sync wants (R-BTN-94) |
| Forge notification | `POST /v1/forges/{repository}/notify` | the forge's verifier under `BATON_FORGE_SECRETS` (R-BTN-95) | record a sync want for its own repository (R-BTN-156) |
| GitHub App webhook | `POST /v1/github/webhook` | `X-Hub-Signature-256` by the App's webhook secret (R-BTN-73) | trigger a sync dispatch; Baton reads only R-BTN-73's fields |
| Instrument (probe) | `/v1/probe/*` | SSH-signed | post readings of any registered instance (R-BTN-101) |
| Registration token (proposed, R-BTN-117) | `POST /v1/register` | `Authorization: Baton-Token <token>` | register one credential within its scope (R-BTN-117, R-BTN-157) |
| Administrator | `/v1/admin/*`; any claim's leg runs | a `BATON_ADMIN_KEYS` line, SSH-signed or API key | R-BTN-57 |
| Dashboard session | `/v1/ui/*`, and the `GET`s §14 lists a session on | the session cookie (R-BTN-155) | as `session` (R-BTN-129), an administrator's session: every action §14 lists `session` on. Outside `/v1/ui/*` a session reads only: the request is the session's when it carries the cookie and no key (§14). Owners' sessions and confirmation codes are proposed ([people and dashboard, §3](../proposals/people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions)) |
| Repository owner | `/v1/owner/{repository}/*`; the repository's reads and leg runs | an owner key, SSH-signed or API key | R-BTN-58 |
| Human-only key | `POST /v1/human-keys`; `POST`, `DELETE …/attestations` as writer `human`; as an owner, or as a break-glass line on every repository it satisfies (R-BTN-188), the owner's routes | an SSH key registered `human_only` (R-BTN-185), on an owner key or a key of no other role | open human gates (R-BTN-185), `human-key.add` and `human-key.revoke` among them; as an owner, R-BTN-58; never through a session, which is `owner` |
| MCP key (a delegated key; proposed, [people and dashboard, §2](../proposals/people-and-dashboard.md#2-mcp)) | `POST /v1/mcp` only | bearer `bmcp_…` | as `owner` on one repository, narrowed to the ids listed at minting: R-BTN-186, R-BTN-130 |
| Public | `POST /v1/login`, the dashboard shell's three assets — its page, its one script, its one stylesheet | none, or on `POST /v1/login` a verified Cloudflare Access assertion (R-BTN-155) | start a sign-in |

The repository reads (`GET /v1/repositories/{repository}/…`) are open to any key granted on the
repository, its owners and administrators, except where a route's rule narrows them.

- **R-BTN-179 (the state is readable with a key).** What the dashboard's state answers is
  answered to a signed key too, by the same queries with the session-link projection of R-BTN-113:
  `GET /v1/admin/repositories` (administrators: the registry as `/v1/admin/state`'s
  `repositories`, plus `seed_owners` — the unretired repositories whose live owner keys are all the
  deploy seed's, or that have no live owner, R-BTN-58); `GET /v1/owner/{repository}/grants` (its owners: that repository's `owners`,
  `grants`, `mcp_keys` and `settings`, and the bars in force or scheduled, R-BTN-146, each grant also naming
  the `other_repositories` its key holds); and
  `GET /v1/repositories/{repository}/board` (the repository reads' principals: the repository,
  its `ready` tickets, `granted_capabilities`, the repository's live claims
  as `holders` — each with its holder and when its lease ends (null for a legacy claim) — and `server_time`). A key outside the route's role is refused as this
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
- **Bearer secrets.** API keys (`bak_`) are stored only as hashes, are valid in one tenant, and
  are compared over their full digests in constant time; so is every forge and webhook MAC. A
  one-time sign-in link's token and a dashboard session's value (64 hexadecimal characters
  each, no prefix; R-BTN-155) are stored only as hashes and found by their hash. The prefixed
  secrets of designs not built — registration tokens (`brt_`), MCP keys (`bmcp_`), pending
  sign-ins (`bps_`) and prefixed sessions (`bds_`) — are proposed
  ([people and dashboard](../proposals/people-and-dashboard.md),
  [checks and executors](../proposals/checks-and-executors.md)).

### 12.2 Destructive actions

These actions take `confirm: true` in the body, or are refused `confirm-required`. Where the
CLI offers the action it asks or takes `--yes`; where the dashboard offers it its dialog sends
the confirmation. Confirmation does not grant authority to perform the action.

- `leg.stop`, `claim.force-reap`, `claim.fence-clear`;
- `owner.owner.remove`, `owner.grant.revoke`, `human-key.revoke`;
- removal of a policy floor (R-BTN-189);
- `admin.key.revoke`, `admin.repo.retire`.

Not built: `ticket.cancel` (R-BTN-12), `owner.sync-key.revoke` (B-301), and an administrator's
change of a repository's path (R-BTN-138, B-45). Each takes the same confirmation when built.

Proposed, each with the design that brings its action: a `code_repos` consent (R-BTN-140;
[data model and API](../proposals/data-model-and-api.md)), `owner.check-runner.revoke` and
`owner.token.revoke` ([checks and executors](../proposals/checks-and-executors.md)),
`attestation.revoke` ([security](../proposals/security.md)), `admin.repo.resync`
([tickets and sources](../proposals/tickets-and-sources.md)), `owner.mcp-key.revoke` and
`confirm` over MCP as a schema check only ([people and dashboard, §2](../proposals/people-and-dashboard.md#2-mcp)),
`owner.sessions.revoke`, `admin.sessions.revoke` and the confirmation code a dashboard
session's authority-changing actions also need
([people and dashboard, §3](../proposals/people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions)).

### 12.3 Untrusted text

Every value below is validated on write; a value over its cap is refused `invalid-params`.

- **Free text** (`session_name`, an activity's `label`, `end_reason`, message payloads,
  rate-limit details): `session_name` by R-BTN-3's pattern; every other at most 500 characters,
  with no control characters and none of `<`, `>`, `{`, `}`, `` ` ``.
- **Activity `detail`** (§9.9): an object of at most 16 keys matching
  `^[a-z][a-z0-9_]{0,31}$`, whose values are numbers, booleans, free-text strings or a
  pull-request URL, plus under the one key `resume` a nested object under the same rules; at
  most 2 KB. A pull-request URL is the `web_base` (R-BTN-92) of the ticket's home, or of a
  `repos:` entry with reach (R-BTN-140) — on that repository's own forge, whatever the home's —
  followed by the forge's path: `/pull/<n>` on GitHub, `/pulls/<n>` on Gitea,
  `/-/merge_requests/<n>` on GitLab, none on a plain `git` repository of its own.
- **Identifiers.** A ticket's local id matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and is
  qualified as `<repository id>:<local id>` (R-BTN-47); a decision id or restart id matches
  `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`, the prefix `baton.` reserved to core; an `asks` label
  matches `^[a-z][a-z0-9-]{0,31}$`; a condition type follows R-BTN-160. This is the ticket-id rule
  the other sections cite.
- **Ticket versions and keys**: a ticket's `version` — the ticket source's opaque
  string — matches `^[A-Za-z0-9._:+/=-]{1,128}$`; its `key`, the source's stable name, matches
  `^[A-Za-z0-9][A-Za-z0-9._:+/=-]{0,255}$`. Both are untrusted text validated on write; Baton
  compares each for equality only (values 4), never orders two and never reads one as a time.
- **Links.** Every link Baton accepts or draws passes R-BTN-92's link rule for one of the
  ticket's repositories with reach (R-BTN-140) — each by its own `web_base`, so a plain `git`
  home draws its code repositories' links while none of its own — or names a host an
  administrator allowed:
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
- **Rendering.** The dashboard renders every value as a text node (a React text child or
  `textContent`); a value whose schema carries a view is drawn by R-BTN-112's `ui` renderer —
  its node tree mapped to elements with text children, the schema fetched from
  `GET …/schemas` — and any other blob only as pretty-printed JSON. The dashboard's own
  source (`src/dashboard/**`) never uses `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, `DOMParser` or `createContextualFragment`: React is
  the only code that touches the DOM, and the page is one bundle built from this repository that
  loads no script, style, font or data from another origin. Links on the client pass the same
  `src/shared/links.mjs` rule the server applies, with `web_base`, `link_hosts` and
  `session_hosts` from the read. `baton leg log` strips terminal escapes and every C0 and C1
  control but newline and tab (R-BTN-128).
- **Models.** Profiles, reports, readings' `detail`, course fields, resume records, hand-off
  documents and an earlier claimant's text reach a model only as quoted data, in their own file,
  never in instructions (R-BTN-144, R-BTN-152).
- **The mirror** (§16; legacy, removed with its code, R-BTN-193) runs `check-note-mdx` on every
  note it writes, with free text in code spans; a failing note is written without its free text
  and flagged.

### 12.4 Same-site with the product

- **R-BTN-16 (same-site with the product).** A Baton may share its registrable domain with
  origins that run untrusted code. So, on every host:
  - **Cookies.** Baton sets one cookie and reads no other: the dashboard session
    `__Host-baton_session` (12 hours, R-BTN-155), `__Host-` prefixed, host-only, `Secure`,
    `HttpOnly` and `SameSite=Strict`, so no other origin on the domain can set or shadow it. A
    second cookie, for a pending sign-in by code, is proposed
    ([people and dashboard, §3](../proposals/people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions)).
  - **Headers.** Every response carries `Content-Security-Policy: default-src 'self';
    frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`,
    `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
    and `Cross-Origin-Resource-Policy: same-origin`; every response to a request a credential
    or a dashboard session authorizes, and every response that sets a cookie (`POST /v1/login`,
    R-BTN-155), also carries `Cache-Control: no-store`.
  - **Writes.** A state-changing request a dashboard session authorizes and `POST /v1/login`
    must carry `Content-Type: application/json` and an `Origin` equal to the tenant's origin
    (`BATON_ORIGIN`; locally `--origin`), else `forbidden`.
  - **Every session request.** Any request a dashboard session authorizes, reads included,
    carries an `Origin` equal to the origin when it carries one, and `Sec-Fetch-Site:
    same-origin` when it carries that header, else `forbidden`. This is a check on the
    session's API requests (including the shared reads below), not on public dashboard page
    loads. The session-assisted condition redirect falls back to the public page if the
    checks do not pass.
  - **Sessions.** `/v1/ui/*` requires a dashboard session of an administrator key (R-BTN-155). Outside `/v1/ui/*` a session authenticates only the `GET`s §14 lists it on —
    the reads it shares with the keys — and no write.
    Cloudflare Access may stand in front of the dashboard; Baton never requires it and never reads
    its cookie. Baton verifies the assertion Access forwards, and that assertion alone
    authenticates `/v1/ui/*` only while no administrator key is configured (R-BTN-155). Where
    Access stands, it covers only the dashboard's pages (`/`, `/login`, every §11.4
    screen path, `/conditions/{condition}` (R-BTN-163)), `POST /v1/login` and
    `/v1/ui/*`; every other route authenticates each request itself or is public, and is called
    without an Access cookie.

### 12.5 The local host and bearers

- **R-BTN-158 (the local host, and bearers over `http`).**
  - **Binding.** `baton server start` binds `127.0.0.1` unless `--host <address>` says otherwise.
    TLS is the operator's: a front (a reverse proxy, Tailscale serve) terminates it, and
    `--origin` names the front's origin, against which R-BTN-135's host check holds. A
    non-loopback `http` origin gets no dashboard, because its cookie is `Secure`.
  - **Bearers never cross `http` (not built, B-46).** The CLI and the runner refuse to send a
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
  - **The trusted proxy (not built, B-46).** `--trusted-proxy <address>`, naming the one front
    whose forwarded client address Baton reads, for the sign-in limits
    ([proposed](../proposals/people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions)).
  - **File modes (not built, B-46).** At start the local host exits 2 on a group- or world-writable `--db`, secret
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
    (R-BTN-55), never in the object (§2.1). Baton's server is trusted with it (§12.8).
    Without the App, a repository's workflows run on their schedule and runners answer wants.
  - **Dispatch only what is named.** Actions: write lets the App dispatch any workflow, so Baton
    dispatches only a repository's `sync_workflow`, `mirror_workflow` (legacy, R-BTN-193) and its owners'
    unblocked trigger, whose workflow is limited by R-BTN-94. A repository whose other workflows must not
    be triggered gives them no `workflow_dispatch`.
- **The check App is another App** (R-BTN-115), created by `baton admin check-app create --org
  <org> --key-out <path>` through the same manifest flow (R-BTN-57) with Checks: write and no
  other permission; its private key is written to `--key-out` on the delivering runner's host,
  never to the secret sink, and its App id to the instance setting `check_app_id` (`PUT
  /v1/admin/settings`, §13.1), one per tenant as the App is, which the sync is handed with its
  observation, and R-BTN-115's read-back and `baton repo protect --print`
  read. An organisation owner installs it on each repository whose `checks` setting names a course,
  never on "All repositories" (R-BTN-115). Branch protection names it,
  never the dispatch App (R-BTN-115).
### 12.8 The repository policy and its guarantees *(partly built)*

Baton specifies mechanisms, each with what it guarantees; a repository's **policy** chooses which
of them hold. The policy is Baton state, one document per repository, set by its owners and never
read from git. What a policy guarantees is computed from its values (R-BTN-189); a deployment
that depends on Baton requires guarantees by name and lists them as the policy's floors, which
Baton enforces.

Built: one versioned policy document per repository, changed by compare-and-set under
`approvers.policy` and logged (R-BTN-188); the approver lists, the refusal of a list no live
credential can satisfy, and break-glass; the guarantees computed over each version and
answered by the policy read, and floors, with `floor-violated` and the stop of a repository
whose floor is broken (R-BTN-189); the store of a protection checker's report, its lapse and
`baton.unprotected` (R-BTN-180); human-only keys (`POST /v1/human-keys`, R-BTN-185); and a
person's answer as a `std:decision@1` attestation (R-BTN-181). The built document's knob
names, presets and guarantee names are those of `src/core/policy.ts`, which the tables below
do not match everywhere. Not built: any route that sets a grant's role, domain or checker
mark (R-BTN-180), so no grant is the protection checker and no protection report counts.
Proposed, in [the security proposal](../proposals/security.md) (B-136, B-137, B-140, B-141,
B-146, B-147): what enforces `merge.*`, `paths.*` and `tickets.created: proposed` — trusted
runners, the merge runner, the fact reader and attestations of every other type. Until those are
built, a guarantee that names such a knob reports the policy's values, not their enforcement.

**Baton's server is trusted.** Its compromise, or its Cloudflare account's, is recovered, not
resisted: Baton signs no outbox entry and no policy read and publishes no signing key, and a
trusted runner pins nothing and acts on Baton's record as Baton gives it. Who may tell Baton
something is the question every rule below answers.

**Not observed by Baton; the deployment's.** Baton rules on a fact only when Baton, the forge at
the ref classes `refs.*` names, or a trusted runner enforces it (R-BTN-188). It records what it
is told about everything else and verifies none of it:

- how a leg is kept apart (R-BTN-107): what a leg ran and could reach, a review leg and a trusted
  leg's override included; whether a domain is reset between tickets; what a domain label stands
  for, and whether a trusted runner's or the protection checker's domain serves another grant;
- where runners, trusted runners, the protection checker and their credentials live, and how
  their CLI is installed;
- custody of a human-only key, of a break-glass line and of the human identity's forge
  credential: an agent session that can use one is, to Baton and to the forge, the human;
- the forge beyond those ref classes: its secrets, environments and privileged jobs, a leg's own
  forge credential, what the forge runs from a ref a leg pushes, and the refs no forge rule can
  restrict;
- whether a human read what they approved.

Outside every guarantee as well: a compromised runner that is one of the reviewers
`merge.reviews` requires and whose change or findings persuade the others; a compromised host of
trusted runners or of the protection checker; a compromised forge; and a compromised Baton.

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
    `baton owner policy show | diff | log` read it. Each change is logged `admin` with the
    versions and the knobs it changed, and is checked against the floors (R-BTN-189) and the
    current courses (R-BTN-181) in its transaction.
  - **Reading a current legacy policy.** Only the current version is projected onto the current
    knob table, using that repository's live legacy floor rows (R-BTN-189). The policy read's
    effective hash is over the projected document. Historical reads use the stored documents
    and hashes, including for the history's knob diffs; they neither project versions nor attach
    today's floors to them. A migration validates each repository's current projection in one
    transaction and logs its old and effective hashes as an `admin` event when they differ or
    when the guarantee comparison (R-BTN-189) reports a held guarantee with no successor.
    Only a subsequent write authorised by the prior `approvers.policy` appends a version; it
    links to the prior version's stored hash.
  - **No new authority from a projection.** Rename `approvers.trust` to `approvers.roles`
    without changing its list. Drop `courier` from writer and deliverer lists; never translate
    it to `runner`. Read a missing legacy `outbox.source` with no deliverers. Carry the old
    answer restriction into `std:decision@1` without adding a writer: in particular a policy
    that required `inputs.answers: attestation` must still refuse ordinary owner answers.
    Compare effective permissions before and after, including defaults and fixed rules. For
    `refs.baton` and `refs.legs`, compare the old writer sets with the sets that R-BTN-180
    supplies after projection; refuse if any writer is newly admitted to either namespace.
    Reject a projection that adds authority or leaves a policy that could not work, including
    an unsatisfiable approver list under the repository's `human_key`. The migration fails
    atomically and names the repository and the offending knob or floor. It changes no grant.
  - **Previewing a policy change.** `dry_run: true` (`--dry-run` on `policy apply` or `policy set`)
    uses the same current version, approver and change validation as apply, but changes no
    policy or trust settings and adds no policy audit event. `changed` lists the changed knobs;
    `guarantees` gives their projected result using Baton's current protection report.
    `trust_cleared` lists the trust settings apply would clear (`grant:<fingerprint>` or
    `courier:<fingerprint>`), not grants it would revoke. On a change from `inputs.answers: git`
    to `attestation` with no human-only key admitted by the decision route (R-BTN-116),
    `stops.legs` lists the person legs that could take an answer from each live ticket's current
    station, including when another leg is queued, as `{ticket_id, leg}`. `stops.tickets` lists
    their distinct qualified ticket ids. This reports loss of the answer path, not loss of expiry
    or of other legs the ticket can take.
    `not_evaluated` names the effects this preview does not predict: `outbox-delivery`,
    `leg-attestation-requirements`, `trusted-merge` and `repos.unlisted`.
  - **Who may change it.** Every change to the policy, in any direction, needs an approver on the
    `approvers.policy` list as it stands before the change; Baton never asks whether a change
    tightens or loosens. A change to any `approvers.*` list is authorised the same way, never by
    the list being written.
  - **The knobs and the presets.** The presets are the named columns below and `plain-git`,
    shipped with Baton. The `cooperative` column is a new repository's policy on a forge, and
    `plain-git` where `forge` is `git`. `protected-hardware` equals `protected` except where its
    column says otherwise.

    | Knob | `cooperative` | `protected` | `protected-hardware` | Enforced by | Rule |
    |---|---|---|---|---|---|
    | `approvers.members` — adding or removing owners; granting or revoking runner keys; registering check-runners, sync and mirror keys; consenting to another home's `code_repos` entry; minting registration tokens and MCP keys | `[owner]` | `[human]` | | Baton | R-BTN-58, R-BTN-93, R-BTN-114, R-BTN-117, R-BTN-130, R-BTN-140 |
    | `approvers.roles` — a grant's role, its domain and the checker mark | `[owner]` | `[human]` | | Baton | R-BTN-180 |
    | `approvers.policy` — every change to this policy, this list and `floors` included; every loosening of an R-BTN-66 setting; every `baton ticket adopt` | `[owner]` | `[human]` | | Baton | R-BTN-186, R-BTN-189, R-BTN-39 |
    | `human_key` — the minimum for a human-only key acting on this repository, `any` or `hardware`; the instance's is a floor under it | `any` | `any` | `hardware` | Baton | R-BTN-185 |
    | `human_identity` — the human-only identity as the forge shows it: on a forge its immutable forge user id (R-BTN-138's kind), on `git` the pusher identity the `pre-receive` hook logs | null | no value | no value | Baton, trusted runners | R-BTN-184, R-BTN-192 |
    | `refs.default_branch`, `refs.tags`, `refs.other` (branches outside `branch_pattern`) — who may update them, from `runner`, `trusted-runner`, `mirror` (legacy, R-BTN-193), `human` | all four, for each | `[trusted-runner, human]` for each | | the forge; the protection checker checks it | R-BTN-180 |
    | `paths.protected` — the owner's protected paths, beside the computed floor | `[]` | `[]` | | trusted runners, the forge | R-BTN-184 |
    | `paths.control` — who lands a control path: `any`, `trusted-runner` or `human` | `any` | `human` | | trusted runners, the forge | R-BTN-184 |
    | `paths.tickets` — `any`, or `approval`: a ticket or goal change needs a human's approval | `any` | `approval` | | trusted runners | R-BTN-183, R-BTN-184 |
    | `merge.trusted` — merge legs are trusted legs, and no course commits to the default branch | `false` | `true` | | Baton, the forge | R-BTN-182 |
    | `merge.reviews` — `{count}`: the `std:review@1` a merge needs at its head, from `count` distinct domains, each other than every writer domain | `{count: 0}` | `{count: 2}` | | trusted runners | R-BTN-183 |
    | `merge.checks` — `optional` or `required` | `optional` | `required` | | trusted runners, the forge | R-BTN-183 |
    | `tickets.created` — how a ticket a runner's action creates, and a withdrawal, reach git: `filed` or `proposed` | `filed` | `proposed` | | Baton, trusted runners | R-BTN-161, R-BTN-165, R-BTN-171, R-BTN-180 |
    | `outbox.git`, `outbox.forge-check` — `{deliverers}`: which grant roles may deliver the kind, from `runner`, `trusted-runner` | `{deliverers: [runner]}`, each | `{deliverers: [trusted-runner]}`, each | | Baton | R-BTN-171 |
    | `outbox.source` — `{deliverers}`: which grant roles may deliver the source kinds, from `runner` alone | `{deliverers: [runner]}` | `{deliverers: []}` | | Baton | R-BTN-171 |
    | `inputs.board` — who may post the board, from `sync-key`, `ci-identity`, `machine` | all three | `[sync-key, ci-identity]` | | Baton | R-BTN-93, R-BTN-102, R-BTN-187 |
    | `repos.unlisted` — whether a home that lists no `code_repos` reaches its tickets' `repos:` entries by name: `by-name` or `none`; a stored version naming none reads as `by-name` | `by-name` | `none` | | Baton, the sync | R-BTN-140 |
    | `attestations` — `{<type>: writers}`: whose attestations about work count; an absent type admits no writer, except `std:evidence@1`, which a policy stored before it existed admits from `sync` (R-BTN-203) | each `std:` type's standard writer (R-BTN-181), `runner` for the holder's `std:arrival@1` and a deliverer's `std:effect@1`, `sync` for the `std:git.*` types, `std:arrival@1`, `std:evidence@1` and `std:decision@1` (R-BTN-191); `std:checks@1` absent until the owner names a check-runner's key (R-BTN-114) | as `cooperative`, except that `std:arrival@1` admits the fact reader's `service:` key once the owner names it (R-BTN-192) and never `sync`, and `std:decision@1` admits `human` alone | | Baton, trusted runners | R-BTN-181 |
    | `readings` — `{<resource> \| "*": {writers}}`: whose readings count for this repository; `*` covers every resource not listed; an absent entry admits no writer | `{"*": {writers: every writer R-BTN-76 lets report}}` | as `cooperative` | | Baton | R-BTN-76, R-BTN-181 |
    | `floors` — the guarantees no change to this policy may break | no value | no value | no value | Baton | R-BTN-189 |

    Owner settings outside the policy stay R-BTN-66 settings, whose loosening `approvers.policy`
    governs (R-BTN-186).
  - **Applying a preset** writes every knob the preset has a value for, which `floors` and
    `human_identity` never are, so an apply neither sets nor clears a floor. In `attestations` it
    keeps every `service:<fingerprint>` entry the document already names for a type the preset
    admits a `service:` key for (`std:arrival@1`, `std:checks@1`). The stored document never
    names a preset, and no rule reads one.
  - **`plain-git`** is the `cooperative` column with `inputs.board` `[sync-key, machine]` and no
    `outbox.forge-check` deliverer (R-BTN-92). A `git` repository may apply `protected` or
    `protected-hardware` instead; Baton then takes `ci-identity` and every `forge-check`
    deliverer out of what it writes.
  - **A policy that could not work is refused** (`invalid-params`, naming the knob):
    - one whose `outbox.git` admits a role that the ref class its writes land on excludes —
      `refs.default_branch` under `tickets.created: filed`, `refs.other` under `proposed`;
    - one whose `refs.default_branch` excludes `runner` while `tickets.created` is `filed`;
    - on a `git` repository, `ci-identity` in `inputs.board` or a `forge-check` deliverer;
    - on a repository whose ticket source is ejected (R-BTN-74), an `outbox.source` admitting no
      deliverer; the other way, a snapshot that ejects the source while `outbox.source` admits
      none is refused `snapshot-rejected`, the previous source staying in force;
    - `paths.control: human`, or an `attestations` entry admitting no `sync` for
      `std:arrival@1`, while `human_identity` is null;
    - a `human_identity`, or any floor, while the repository's `code_repos` names an entry on a
      host other than the home's: one identity cannot be told from a pusher's across hosts.
      Adding such an entry is refused while either stands (R-BTN-140).
  - **Approvers.** Each `approvers.*` knob is a non-empty list; a credential is an approver for
    it when it matches an entry:
    - `owner`: any owner key or owner session of the repository; an administrator (R-BTN-57)
      matches an `owner` entry on every repository and no other;
    - `human`: any `human_only` key that is an owner of the repository and meets `human_key`
      (R-BTN-185);
    - `key:<fingerprint>`: that one key, and a dashboard session of that key (R-BTN-155) when the key is not
      `human_only`, while it is an owner of the repository, and meeting `human_key` when it is a
      `human_only` key.

    A key becomes an owner of a repository only by that repository's `approvers.members` action;
    registering a `human_only` key with the tenant makes it an owner of nothing. A delegated key
    (R-BTN-186) matches no entry. A list is **human-only** when every entry is `human` or names a
    `human_only` key; an action whose list is human-only is a **human gate**, for administrators
    too: an administrator performs it only with a `human_only` key the list admits.
  - **No gate without a key to open it.** Baton refuses a list no live credential can satisfy: a
    `key:` entry for a revoked, suspended or unknown key does not count, and a human-only list
    needs a `human_only` key meeting the resulting `human_key` among the repository's owners.
    Baton refuses removing an owner, revoking or suspending a key, and an instance switch of
    `human_key`, when a list would be left with no live credential to satisfy it
    (`unsatisfiable-approvers`, naming the list).
  - **Break-glass.** A key in the host's `BATON_HUMAN_KEYS` configuration satisfies every `human`
    entry of every repository on the instance whose `human_key` it meets; a line that does not
    meet `hardware` satisfies nothing on a repository that requires it. It is set outside Baton
    and is the only recovery from a lost key.
  - **Making `approvers.roles` human-only** clears every role, mark and domain set by a credential
    the new list does not admit (`runner_grants.set_by`, §13): each such grant is an ordinary
    `runner` with no domain until an approver on the list sets it again, and a cleared mark voids
    the checker's last report (R-BTN-180).
- **R-BTN-189 (guarantees and floors).**
  - **A guarantee** is a named condition over the policy, defined here, and held or broken for
    each version. A deployment defines its own guarantees in its own specification, out of these
    and of what it enforces itself; Baton knows only these. Each includes the guarantees it rests
    on.

    | Guarantee | Promises | Holds when |
    |---|---|---|
    | `no-runner-lands` | no runner updates the default branch, a tag or a branch outside its pattern; a runner's work lands only through the merge runner under `merge.*`, or by the human identity's own merge of its PR | `refs.default_branch`, `refs.tags` and `refs.other` admit only `trusted-runner` and `human`; `paths.control` is not `any`; `merge.trusted`; `tickets.created` is `proposed`; `outbox.git` admits only `trusted-runner`; and the latest report from the protection checker, within 24 hours, matched (R-BTN-180) |
    | `control-paths-human` | no control path (R-BTN-184) changes without a human landing it | `no-runner-lands`, and `paths.control` is `human` |
    | `tickets-approved` | no ticket or goal changes, and no ticket a runner creates is filed, without a human approval of that file: a `std:approval@1`, or the human's merge of the PR carrying it | `no-runner-lands`; `paths.tickets` is `approval`; `tickets.created` is `proposed`; `attestations` admits only `human` for `std:approval@1`; and the last accepted post's ticket source is the markdown source (`source.kind: markdown`, R-BTN-74) |
    | `independent-review` | a runner's change the merge runner lands has two reviews from domains other than its writers' and each other's (R-BTN-180); what the human merges by hand, the human has reviewed | `no-runner-lands`; `merge.reviews.count` ≥ 2; and `attestations` admits only `baton` for `std:review@1`, `std:wrote@1` and `std:ran@1` |
    | `human-gates` | no owner's agent session, and no delegated key, changes membership, roles or the policy, and every human approval is made on a hardware key | `approvers.members`, `approvers.roles` and `approvers.policy` are human-only lists, and the repository's `human_key` is `hardware` |
    | `board-from-trusted` | nothing a trusted leg acts on comes from a runner's board post or from git verdicts | `no-runner-lands`; `inputs.board` excludes `machine`; and the `attestations` entries admit no `sync` writer for `std:arrival@1` or `std:decision@1`, and only `human` for `std:decision@1` |

    Every guarantee holds against a compromised runner, within what its knobs' enforcers enforce
    and nothing §12.8's lists exclude. Against an injected owner's agent, one holds only together
    with `human-gates`: an `owner` approver can grant a trusted role or a member, which no other
    guarantee constrains. The `protected` preset holds all but `human-gates`, and
    `protected-hardware` all six; `no-runner-lands`, with every guarantee that includes it, holds
    only once the protection checker has reported a match.
  - **Floors.** The policy's `floors` knob lists guarantees by name. Setting it is a policy change
    like any other, refused when a listed guarantee's policy conditions are not met by the
    document after the change. From then on Baton refuses any policy change after which a
    guarantee the list **in force before the change** names would not be met (`floor-violated`,
    naming the guarantee), whoever asks: a version that drops a guarantee from `floors` and
    breaks it is refused, so a shortening is its own version, made while the guarantee still
    holds. A consumer reads the `floors` list and the computed `guarantees`, never a floor's name
    alone.
  - **Comparing legacy guarantees.** Compare policy conditions on the same repository facts,
    without the protection report. Compare `no-runner-lands`, `control-paths-human`,
    `tickets-approved`, `independent-review` and `board-from-trusted` by name, and compare
    legacy `human-gates-hardware` to current `human-gates`. A held comparable guarantee
    becoming broken stops the migration, even if unfloored. Legacy `human-gates` (the weaker
    condition), `signed-authorship` and `trusted-domain-separate` have no migration successor.
    Report each such held guarantee that was not floored in the repository's migration audit;
    it does not by itself prevent migration. This comparison does not replace R-BTN-188's
    check against widening authority.
  - **Legacy floors.** Project the union of the guarantees the named rows list, using the
    comparison's successor names. A floor on `human-gates-hardware` thus becomes a floor on
    `human-gates`, provided its policy conditions and removal restriction are preserved. A
    floor with no successor or whose successor's policy conditions are unmet stops migration.
    The prior `approvers.policy` gate must imply the old `remove_by` gate not only now but in
    every allowed later version that retains the floor. Reject a floor if the document cannot
    preserve that restriction: `[human]` today does not preserve `remove_by: human` if a later
    version can keep the floor and switch to `[owner]`. Likewise a later `[human]` could
    admit a break-glass key that is not an owner, so `remove_by: owner` is not inherently
    redundant either. Do not clear a floor on the repository's behalf.
  - **Floors are judged on the policy alone.** The protection report is not a policy condition,
    so a lapsed or failed report never refuses a change. It breaks `no-runner-lands` all the
    same: Baton raises `baton.unprotected` (R-BTN-180), and a floor that names it stops the
    repository.
  - **A broken floor stops the repository, in Baton.** While a guarantee `floors` names is broken,
    Baton offers and accepts no claim or advance on any ticket that reaches the repository, homed
    there or naming it in a `repos:` entry with reach (rule `floor`, `floor-broken`), and sends
    every running claim on such a ticket a `release` with reason `floor`, which ends it
    `released:floor`. The protection checker is exempt and keeps checking. Baton enforces this
    itself, never by asking runners.
  - **The read.** `GET /v1/repositories/{repository}/policy` answers owners, administrators and
    keys granted on the repository with `{repository, version, hash, policy, guarantees: {<name>:
    held | broken}, floors, check_app_id, at, valid_until}`. `check_app_id` is the instance
    setting (§12.7). The response is unsigned; `valid_until` equals `at` for CLI 0.1.3 and
    0.1.4 compatibility, not as a validity guarantee. A trusted runner and a deployment's
    audit read the same route, each with its own key.
- **R-BTN-180 (roles, domains and protection).**
  - **Every grant has a role and a domain.** The role is `runner` or `trusted-runner` (R-BTN-182),
    and a `trusted-runner` grant may further be marked the repository's protection checker
    (`checker`); the domain is a label (1–128 characters of `[A-Za-z0-9_.:-]`). The role, the
    mark and the label are set by the `approvers.roles` approver, `trusted-runner` refused for
    an API-key credential (`invalid-params`; a trusted runner signs, R-BTN-159); a grant nobody
    marked is a `runner` with no domain. Baton compares domains as labels and verifies nothing
    about them. The route that sets them (`PUT /v1/owner/{repository}/grants/{fingerprint}/role`)
    is not built ([proposed](../proposals/data-model-and-api.md)): every grant is a `runner`
    with no domain.
  - **How runs compare** (proposed with the role route). A run is attributed the domain its
    grant had when the run started (`claim_legs.domain`). Two runs count as **different domains** when their domains differ and
    their runner keys differ; every other pair counts as the same, so no grant becomes
    independent of itself by being re-domained. A grant with a null domain counts toward no
    `merge.reviews` and is never a trusted runner.
  - **Refs.** A runner or mirror updates only the ref classes `refs.*` admits it to, and a runner
    admitted to no ref outside `branch_pattern` updates only refs matching it. `refs/baton/*` is
    open to every writer, and Baton reads nothing from it that a trusted leg acts on;
    `baton-legs/*` is open to `runner`, `trusted-runner` and `human` (R-BTN-190). The forge
    enforces the classes; Baton states them.
  - **Only the protection checker's report counts.** The **protection checker** is a
    `trusted-runner` grant that the `approvers.roles` approver marks as the repository's checker
    (the marking and its refusals are proposed with the role route).
    A marked grant is offered no leg and admitted to no `outbox` class, and Baton refuses to mark
    a grant whose domain is null or carried by another grant of the repository, that has claimed
    a trusted leg, or that delivers a class (`invalid-params`). It reports `{matched,
    reading_hash}` with its heartbeat's `protection`, at least hourly, which Baton keeps as the
    repository's last report (`repositories.protection_json`, §13). Only its reports feed
    `no-runner-lands`; clearing the mark voids the last report. A report from any other runner
    only logs a `discrepancy` (R-BTN-85). A report that does not match, or differs from the
    previous reading, raises `baton.unprotected`, a `notify` condition closed by a matching
    report; so does a report's lapse (R-BTN-189). What the check reads on each forge, and
    `baton repo protect --print | --check`, are
    [proposed](../proposals/security.md).
  - **Nothing requires a runner the refs exclude to write the default branch.** Claims, status and
    course history are Baton's, and the standard courses commit only on the ticket's branch under
    every policy (R-BTN-131). Under `merge.trusted`, no course commits to the default branch and
    `merge` legs are trusted legs (R-BTN-182). Under `tickets.created: proposed`, nothing writes
    a ticket file on the default branch directly: a ticket a runner's action would create
    (R-BTN-161, R-BTN-165) and a withdrawal (R-BTN-171) are proposed on a branch and land by a
    human's approval ([proposed](../proposals/security.md)). Where `refs.default_branch` excludes
    `mirror`, the mirror (§16) writes nothing to the default branch.
- **R-BTN-181 (attestations: typed statements about work or about a resource).** A typed
  statement Baton stores, which a leg may require: a review, a check run, a human's approval, a
  provider's remaining quota. Attestations differ only in their subject and their writer; an
  attestation about a resource instance is a **reading** (R-BTN-76).
  - **Writers.** Baton records an attestation's writer from the credential that posted it:
    - `human`: a `human_only` key (R-BTN-185);
    - `owner`: any owner key or owner session, an owner's agent included;
    - `baton`: Baton itself, from events it verified;
    - `instrument`: an instrument key; `runner`: a runner credential, a trusted runner's included;
      `admin`: an administrator;
    - `sync` (R-BTN-191).

    Any of them is also `service:<fingerprint>` for its own key, so a policy entry can name one
    key (a trusted runner, a check-runner, one instrument).
  - **Authenticated by the request.** An attestation is a statement by the credential that posted
    it (R-BTN-13, R-BTN-159; the sync's by its board post's authentication, R-BTN-191) and
    carries no signature of its own. It counts only while its writer's key, and for a `baton`
    attestation the attested runner key, is unrevoked.
  - **A person's answer.** `POST /v1/repositories/{repository}/attestations` (`baton decision
    answer`, the dashboard; R-BTN-127) takes a `std:decision@1` (R-BTN-116) from an owner key of
    the repository or a human-only key; where the policy admits only `human` for the type, an
    owner key's is refused `forbidden`. An administrator's key and a delegated key write none
    (R-BTN-57, R-BTN-130).
  - **Whose attestations count is the policy's to say** (R-BTN-188), never the course's. Baton
    admits, for a type `merge` or a trusted leg acts on, only `human`, `baton` and
    `service:<fingerprint>` keys the owner names — never an owner key or an ordinary runner
    grant; and, for a resource a trusted leg requires, a `readings` entry admitting only
    `instrument`, `admin` and such `service:` keys. It checks this both ways: a policy change is
    refused when it would admit another writer for a type a current course's trusted leg
    requires, and a course whose trusted leg requires a type the policy admits another writer for
    is refused at the snapshot that posts it, the previous course version staying in force.
  - **Baton's own state.** The owner-state export does not carry work attestations (R-BTN-88).
    Lost attestations fail closed. Readings are kept and exported as R-BTN-76 and R-BTN-88 say.
  - The attestation's shape, its other types, supersession, revocation and the
    `requires.attestations` prerequisite are [proposed](../proposals/security.md) (B-146).
- **R-BTN-191 (every statement Baton receives about the work is an attestation).** Baton takes
  facts about work in one way: as attestations (R-BTN-181), whoever states them. What else
  reaches it is a **command**: a request to change Baton's own state (a claim, an `advance` or
  end, a heartbeat, an owner's or administrator's action), which Baton accepts or refuses by its
  gates. Attestations differ only in their writer, and the policy's `attestations` entry for each
  type (R-BTN-188) decides whose count.
  - **One writer class** joins R-BTN-181's: `sync`, the credential that posted the board (a sync
    key, the registered CI identity, or a machine key, R-BTN-93), for what it read from git and
    the forge in one run. Its attestations ride in the board post (§4.4, `attestations`), are
    accepted or refused with it, and are authenticated by it.
  - **A person's answer** is always a `std:decision@1` attestation. The person writes it
    (R-BTN-181) or the sync attests the answer the ticket shows; which counts is the policy's: an
    entry admitting `sync` is an answer in git, one admitting only `human` or `owner` is an
    answer in Baton (R-BTN-116). An attestation of a type Baton does not read is kept as evidence
    and recorded `arrival-unapplied` (R-BTN-39).
  - The sync's `std:arrival@1` for a fact leg and its `std:evidence@1` are R-BTN-203's, admitted
    only on a board a sync key or the CI identity posted. Its other
    types, the holder's `std:arrival@1` and a deliverer's `std:effect@1` are
    [proposed](../proposals/security.md).
- **R-BTN-192 (the fact reader).** Where the policy admits no `sync` writer for `std:arrival@1`,
  a fact leg's arrival comes from the fact reader: a trusted runner whose `service:` key the
  policy names. [Proposed](../proposals/security.md) (B-140).
- **R-BTN-182 (trusted runners).** A grant role (R-BTN-180), for the legs a course marks
  `trusted: true`. What a trusted runner claims, runs and re-checks before it acts is
  [proposed](../proposals/security.md) (B-140).
- **R-BTN-183 (review input and what the merge runner merges).** A domain that runs the
  branch's code is one of its writers. Baton records what the deployment declares; the
  deployment makes it true. The writer attestations and what the merge runner requires at a
  PR's exact head are [proposed](../proposals/security.md) (B-140).
  - **Read-only agents (B-141).** A deployment can mark a runner leg `reads_only: true`.
    The runner passes that declaration to the stub and as a hint to the executor (R-BTN-107).
    A deployment installs compatible stubs when opting in. The runner rejects older stubs
    (no `readsOnly: true` export), and the shipped stub checks the pinned graph and refuses an
    opted-in leg when an older runner omits the read-only context. Deployment-owned course code selects the review commit
    through its snapshot override: pass `ctx.review_head`, an exact commit id already present in
    the home object store, when calling `standard(ctx)`. The stub reads that store even when
    the claim clone does not have the object. It never infers the head from a checkout or
    branch name. Replay does not run these legs until it records the review
    input. No standard course opts in.
  - **The workspace.** The agent starts in a temporary directory outside the checkout, with
    `review.diff` from the snapshot and review head's merge base to the review head, and the
    changed regular blobs under `changes/` as non-executable files. No git metadata, symlink,
    submodule or branch harness configuration is extracted. The ticket and leg instructions
    come from the claim's source and control snapshot, not the review head. For a versioned
    ticket this requires the verified source text, even when the ticket also has a path. The stub removes
    the workspace when the agent call ends.
  - **The launch.** The stub takes the harness and model from the snapshot's agent command
    (or the host fallback in R-BTN-131) and builds the command itself. Native settings come
    from the same settings commit: OpenCode's root and `.opencode/` JSON/JSONC supply model,
    default agent, declarative agents and providers; Claude's `.claude/settings.json` supplies
    model and language. The explicit command's model wins. The stub does not forward native
    permission, plugin, hook or MCP settings. No wrapper, project
    configuration from the review head, auto-approval or bypass is passed on. It allows file
    reads and searches only: OpenCode 2.2.3 or newer in the 2.x series uses a standalone
    invocation and a deny-by-default tool policy; Claude Code uses a bare invocation with only
    `Read`, `Glob` and `Grep`. Unsupported agent commands fail. This is a harness restriction,
    not an OS sandbox: the deployment must trust the installed harness, host configuration
    and snapshot course code, and must not grant higher-precedence tool policy overrides.
- **R-BTN-184 (protected paths).** The policy's `paths.protected`, beside a floor Baton computes
  that no course or owner removes, in two classes: **control paths** — courses, workflows, agent
  configuration, the ticket source and what the owner declares — and **tickets and goals**. The
  floor's entries, its glob grammar, how each class lands and a leg's own progress lines are
  [proposed](../proposals/security.md) (B-140).
- **R-BTN-185 (human-only credentials).** A human gate — a `human` attestation or its
  revocation, and every action whose approver list in the repository's policy is human-only
  (R-BTN-188) — is satisfied only by a human-only key's own signature. A human's merge is the
  forge's, recognised by the policy's `human_identity`.
  - **The human-only key** is an SSH key registered `human_only` and used for nothing else. A
    tenant's first is a line of the host's `BATON_HUMAN_KEYS` configuration, as administrators
    are (R-BTN-57), never registered over the API; each later one is registered with a signature
    by an existing one (`baton human-key add`, R-BTN-127; `POST /v1/human-keys`), and any is
    revoked only with a `human_only` key, within R-BTN-188's *No gate without a key*.
  - **`human_key: any | hardware`** is an instance setting, default `any`, which a repository's
    policy may raise for itself (R-BTN-188). Switching to `hardware` suspends every `human_only`
    key registered before the switch that does not meet it; what meets it, and what the CLI
    shows before a signature, are [proposed](../proposals/security.md) (B-136). Under `any` a
    human-only list is a custody promise: Baton cannot tell a key an agent session can use, so
    no guarantee claims it as a human gate (`human-gates`, R-BTN-189).
  - Until FIDO attestation verification is built, no key, including a break-glass line, meets
    the repository's `hardware` minimum. A stored attestation marker alone is not evidence.
  - **The owner's agent** is a principal (§12.1): an owner key not `human_only`. It acts as
    `owner`, never as `human`. A dashboard session of a `human_only` key is an owner's
    session too: no session, and no OAuth approval by one, satisfies a human-only `approvers.*`
    list.
- **R-BTN-186 (authority by credential, not channel).** An action is available on every surface (the
  CLI, the API, the dashboard, MCP) to the principals its `callers` list (R-BTN-129), and to no other;
  a surface lacks an action only for a mechanical reason the registry names.
  - **A delegated key** (an MCP key, R-BTN-130) acts as an owner of its repository, never as
    `human`, for the actions listed at its minting, and may **tighten, and undo its own
    tightenings**: add a hold or a bar, stop a leg, cancel a ticket; and lift a hold it set or a
    bar it added. Everything else stays the owner's. In particular it never loosens what
    another credential set; never routes, adopts or expedites; never resolves a
    condition, whose restart may end what another set or (`park` on `baton.stalled`) set a hold
    it could not lift (R-BTN-163); never writes an attestation or answers a person's leg; never
    holds credential management (`check_runners`, `api_keys`, a grant's `sync` flag); never sets
    or changes `checks` or `unblocked_trigger`, in either direction; and never performs an action
    an `approvers.*` list governs. This is the one rule of what a delegated key may do; the
    registry's `delegated` marks derive from it and R-BTN-130 exposes over MCP exactly what they
    admit (R-BTN-129).
  - **Loosening** what another credential set — lifting another's hold, removing or narrowing
    another's bar, any change that loosens an R-BTN-66 setting — is an `approvers.policy`
    approver's (R-BTN-188): an owner's under `[owner]`, a human's under a human-only list.
    Tightening is open to any owner credential.
- **R-BTN-187 (what Baton trusts from a board post).** Who may post the board is the policy's
  `inputs.board`, and whether what a post read from git counts is its `attestations` entries
  (R-BTN-188, R-BTN-191). A webhook delivery only triggers a sync (values 6). Per-key limits on observation numbers, board posts and concurrent claims are
  [proposed](../proposals/security.md) (B-137).

### 12.9 A leg's scope

A leg's scope is its ticket's home and the `repos:` entries that have reach (R-BTN-140), each by
its whole forge path (a GitLab subgroup's `group/sub/repo` names its repository by all three
segments). The claim answer carries it. Two reports say what a leg did outside it:

- **The runner's audit is a cooperative aid, not a control.** At each leg's end the runner reads
  the refs the leg's window moved in the home checkout, after the leg's close and hand-off have
  run, so a push either of them made is the leg's too. A tracking ref that appeared or moved
  names a push only when the window's reflog entries say so (`update by push`); a fetch names
  nothing. Each push is mapped to the repository its remote's URL points at (the whole forge
  path), and the actions outside the scope are reported with the claim, on the advance or end
  that finishes the leg (R-BTN-106) — at most sixteen actions, with the count of any beyond
  them, and the report's own shape-drops counted beside them, logged `scope-invalid`, never a
  refusal. The audit runs as the runner's OS user, so a hostile leg can defeat it.
- **The scope cross-check is the control.** Every push delivery (R-BTN-73) whose pusher the
  pushed repository's owners named in their `runner_pushers` setting is checked against the
  claims open at the time — a claim still holding its ticket as rule 3 reads it (active, or
  completed and unconfirmed, or reaped fence-pending), so the delivery of a final push (R-BTN-8)
  that lands after the claim's `end()` still finds the claim that covers it. A push to a
  repository no open claim's scope covers records an `unclaimed-write` finding.
- **Findings.** Each finding is one open row per shape. A `scope-exceeded` or `unclaimed-write`
  finding is listed under Needs you (§14) from the moment it is raised until an owner resolves
  it — the acknowledgement that it was looked at, logged `scope-resolved`. With the owners'
  `scope_policy: hold`, a `scope-exceeded` finding also holds its ticket until an owner lifts
  the hold (R-BTN-12). Both settings are R-BTN-66's: a hold that stops holding, and a
  cross-check that names fewer pushers, are loosening (R-BTN-186).

A third finding, `out-of-course` — a control path changed on the default branch by a push no
course accounts for — and two more kinds of audit action are
[proposed](../proposals/security.md).

**Host forge broker (B-131).** This read is not the audit's open scope. A runner holding a live
leg proves possession with a signed `GET /v1/forge-scope/runner/{run}` (204, no data). A host
broker signs `GET /v1/forge-scope/broker/{run}` with its separate key, whose public half is in
`BATON_FORGE_BROKER_KEYS`. Both reads refuse a run whose lease, leg or grant is no longer live.
The broker's reply carries only the home path, the ticket's explicitly listed code repository
paths and IDs (R-BTN-140), and the time through which the lease and deadline currently hold.
There is no implicit by-name reach or mixed-forge scope for this GitHub.com broker. Baton never
sees the App key or the installation token. Fieldhouse owns minting, renewal and revocation.
