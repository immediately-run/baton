---
title: "Baton — OAuth 2.1 for MCP clients: an owner-approved MCP key, obtained by the standard MCP authorization flow"
description: "Baton as the authorization server for its own MCP endpoint: an owner-approved MCP key, obtained by the standard MCP authorization flow."
status: proposal
updated: 2026-11-19
---

# Baton as the authorization server for its own MCP endpoint

**Status:** proposal — not built (B-73). It builds on the MCP endpoint and MCP key of R-BTN-130
and the owner's dashboard session of R-BTN-155, themselves proposals
([the people and dashboard proposal](proposals/people-and-dashboard.md), §2 and §3). B-73 folds
R-BTN-172 into `BATON_SPEC` §11.3 and this page's §12, §13 and §14 rows into `BATON_SPEC` §13,
§14 and §15.

MCP clients that cannot be handed a bearer follow the MCP authorization flow. This page makes
Baton the OAuth 2.1 authorization server for its own `POST /v1/mcp`. Every authorization it
grants is an MCP key (R-BTN-130), approved by an owner on Baton's dashboard: nothing here widens
what MCP can reach.

It defines one requirement, R-BTN-172, whose parts are §2–§10; one scenario, S-BTN-137; and one
gate, G-BTN-157. `§n` alone means this page's section. The standards are named under Sources;
this page states only Baton's choices where they leave one, and its deviations.

## 1. The flow

The flow is the MCP specification's authorization flow, unchanged: a `401` from `POST /v1/mcp`
(§2), discovery (§2), a client identified by a metadata document or a registration (§3), a
browser authorization with PKCE (§4), an owner's consent on Baton's page (§5, §6), a code
exchanged for tokens (§8). The exchange creates the grant (§7).

## 2. Discovery

- **R-BTN-172 (Baton is the OAuth 2.1 authorization server of its own MCP endpoint).** One
  requirement, whose parts are this page's §2–§10; code cites it as `R-BTN-172` and, where it
  helps, the part (`R-BTN-172 §8`). §2, discovery:
  - **Identifiers.** The issuer is the tenant's origin exactly (`BATON_ORIGIN`, no path, no
    trailing slash; R-BTN-135). The protected resource is `<origin>/v1/mcp`. No other
    authorization server is listed, and Baton accepts no token another server issued.
  - **Where it is served.** On an `https` origin, or a loopback `http` origin for development
    only: a deviation from the MCP revision's "every authorization server endpoint over HTTPS".
    A non-loopback `http` origin serves none of this page's routes (`404`), as it serves no
    dashboard (R-BTN-158).
  - **The challenge.** `POST /v1/mcp` with no bearer, or one that is unknown, expired, revoked
    or refused, answers `401` with
    `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/v1/mcp", scope="read …"`,
    adding `error="invalid_token"` when a bearer was sent, for `bmcp_` keys too. The scope names
    every scope of §7, because clients request exactly the challenge's scope; the owner narrows
    it at consent (§5). No `200` carries a challenge.
  - **Protected resource metadata** (RFC 9728) is served at
    `/.well-known/oauth-protected-resource/v1/mcp` only; the root document is `404`. It is
    `{resource: "<origin>/v1/mcp", authorization_servers: ["<origin>"], scopes_supported,
    bearer_methods_supported: ["header"], resource_name: "Baton"}`, the scopes §7's.
  - **Authorization server metadata** (RFC 8414) is served at
    `/.well-known/oauth-authorization-server`, with §13's endpoints and Baton's choices:
    `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code",
    "refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, both
    `…_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`,
    `authorization_response_iss_parameter_supported: true`. It lists no `offline_access`: every
    grant gets a refresh token.
  - `/.well-known/openid-configuration` is `404`: Baton issues no ID tokens. Both documents carry
    `Cache-Control: public, max-age=300` and are built from configuration, so they are equal on
    both hosts.
  - **No CORS.** Neither the documents nor the machine endpoints send CORS headers, and the
    documents keep R-BTN-16's `Cross-Origin-Resource-Policy: same-origin`: an MCP client running
    in a browser page cannot use Baton.

## 3. Clients

- **Clients are public, identified by a metadata document or a bounded registration.**
  - **Public clients only.** A client authenticates by PKCE alone. Baton never issues a client
    secret; a request carrying one, or an `Authorization` header at the token or revocation
    endpoint, is `invalid_client` (`401`).
  - **Identifier form.** A `client_id` and every redirect URI are RFC 3986 ASCII, with no space
    or control character, and equal to their own parsed-and-reserialized form; anything else is
    refused, so what a person is shown is what is matched.
  - **Client ID Metadata Documents.** A `client_id` beginning `https://` is a document URL:
    - at most 512 characters, with a path and no userinfo, fragment, query, or `.` or `..`
      segment; its host is neither this deployment's own host nor any tenant host it serves
      (R-BTN-135);
    - fetched only for a consent page with an owner's session (§5), never at the token
      endpoint: `GET`, no redirects followed, `200` only, at most 5 KB read, 5 s timeout, JSON;
    - never from an address the IANA special-purpose registries mark not globally reachable
      (RFC 6890 as updated by RFC 8190, IPv4-mapped IPv6 and NAT64 `64:ff9b::/96` included).
      The local host resolves the name, refuses such an address (loopback too, unless its own
      origin is loopback) and connects to the address it checked, keeping SNI and certificate
      validation against the hostname;
    - cached by its exact URL, deployment-wide (public data, R-BTN-135), honouring
      `Cache-Control` within 5 minutes to 24 hours, one hour when absent; a failure or invalid
      document is not cached, and a re-fetch that fails or is over §10's budget serves the last
      valid copy for up to 7 days;
    - valid only if its `client_id` equals the URL byte for byte; `redirect_uris` holds 1–10
      entries, of which those failing §4's form are ignored and at least one passes;
      `token_endpoint_auth_method` is absent or `none`; `grant_types` is absent or within
      `authorization_code` and `refresh_token`; `response_types` is absent or `["code"]`; and no
      `client_secret` appears.
    - `client_name` is kept if it passes `BATON_SPEC` §12.3's free-text rule at 64 characters and
      holds no format character (Unicode Cf), else dropped. Baton fetches nothing the document
      links.
  - **Dynamic registration** (RFC 7591, `POST /v1/oauth/register`) serves clients without the
    document mechanism.
    - The body (JSON, at most 4 KB) needs `redirect_uris` (1–10, each passing §4's form, else
      `invalid_redirect_uri`) and may carry `client_name` (as above), `grant_types`,
      `response_types`, `application_type` and `token_endpoint_auth_method` (`none` only);
      other bad metadata is `invalid_client_metadata`, and other fields are ignored.
    - It answers `201` with `client_id` `bdc_<id>` (64 random bits, hex; public, stored as is),
      `client_id_issued_at`, `token_endpoint_auth_method: "none"` stated explicitly and the
      accepted metadata. There is no registration access token and no client configuration
      endpoint (RFC 7592).
  - **What a person is shown.** A document client is named by its URL's host as an A-label
    (punycode, never Unicode), with a warning when that host is not exactly `claude.ai` or
    `claude.com`; a registered client as "registered client, unverified". `client_name` is
    always shown as self-declared, and the full redirect URI always beside it.

## 4. The authorization request

- **The authorization request and its redirect URI.**
  - **Parameters.** `GET /oauth/authorize` serves the consent page, a static dashboard asset
    that changes nothing. The page sends its raw query string, undecoded, to
    `POST /v1/ui/oauth/requests` (§5), which checks, in this order:
    1. `client_id` appears once and is a valid document URL whose document validates, or a
       stored `bdc_` id (else `invalid_client`);
    2. `redirect_uri` appears once and matches one of the client's (else `invalid_request`);
    3. no other parameter repeats (`invalid_request`); `response_type` is `code`
       (`unsupported_response_type`);
    4. `code_challenge` is exactly 43 base64url characters and `code_challenge_method` is
       `S256`; absent or `plain` is `invalid_request`;
    5. `scope` is space-separated tokens of §7's set (`invalid_scope`); absent means `read`,
       and `offline_access` is dropped;
    6. `resource`, if present, equals `<origin>/v1/mcp`, scheme and host compared without case
       (`invalid_target`, RFC 8707);
    7. `state`, if present, is at most 512 characters of `%x20-7E`, returned unchanged.

    Unknown parameters are ignored.
  - **Redirect URIs.** A requested URI matches a registered one by exact string comparison,
    except loopback: on `http://127.0.0.1`, `http://[::1]` and `http://localhost` the port is
    ignored and the rest compared exactly (RFC 8252 §7.3). Any other registered URI is `https`,
    with no userinfo or fragment, at most 512 characters, and listed exactly in
    `oauth_redirect_uris`: an instance setting of exact URIs, default
    `["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]`;
    empty allows loopback only.
  - **Where answers go.** A failure of step 1 or 2 is shown on Baton's page and never
    redirected. A later failure, a denial (`access_denied`) and success go to the redirect URI,
    with `error` or `code`, `state` and `iss=<origin>` (RFC 9207).

## 5. Consent

- **An owner consents on Baton's dashboard, in the browser that asked.**
  - **The session.** The consent page reads nothing until it has an owner's dashboard session
    (R-BTN-155): its first call, `POST /v1/ui/oauth/requests`, carries the session cookie or is
    refused `unauthenticated`, and the page then shows "sign in to Baton to continue" with a
    link to `/login?as=owner` in a new tab and a Check again button. Without a session the page
    shows nothing about the client, fetches no document and writes no row.
  - **The request.** With an owner's session, `POST /v1/ui/oauth/requests {query}` runs §4's
    checks, writes an `oauth_requests` row bound to that session and living 10 minutes, and
    answers `{request, client, redirect_uri, requested, repositories, expires_at}`. `request` is
    the handle `bor_<id>_<secret>`, kept only in the page's memory. `repositories` are the
    session's repositories on which `api_keys` is not `false` and the session may approve
    (below). A check failing after §4's step 2 answers `{error, redirect}`, which the page
    follows.
  - **What the page shows** (§6): the client as §3 names it, its self-declared name, the full
    redirect URI, and for a loopback redirect "the code goes to whichever program on this
    computer listens on port `<n>`"; a repository picker, preselected when there is one; the
    requested actions, `read` ticked and each write unticked, the destructive ones (`BATON_SPEC`
    §12.2) under their own line "destructive"; the lifetime; and "Approve only a connection you
    started yourself, in this browser, just now: approving lets that client act on this
    repository as you."
  - **Approve.** `POST /v1/ui/oauth/approve {request, repository, actions, ttl?, name?}`
    (`owner.mcp-key.approve`):
    - is refused unless the session is the one the request is bound to (else `not-found`), owns
      `repository` (`not-found`), and is itself an approver on the repository's
      `approvers.members` as R-BTN-188 reads a session (`forbidden`; a human-only list admits
      no session, and its owners mint a `bmcp_` key with a `human_only` key instead);
    - is refused `invalid-params` unless the actions are within the request's scope, what
      R-BTN-186 admits to a delegated key and the owner's own actions, and `ttl` is within
      R-BTN-130's bound; `forbidden` under `api_keys: false`; `conflict` on a name in use;
      `quota` past §10's grant cap;
    - records the approval on the request row and issues the authorization code (§8). It mints
      no grant (§7), so an approval that is never redeemed leaves nothing behind;
    - answers `{redirect, repository, actions}`; the page shows "approved for `<repository>`:
      `<actions>`" and navigates to `redirect`.
    - An approval naming a destructive action is R-BTN-155's confirmed action: it answers
      `202 {confirm_code}`, the owner confirms the code with the key that minted the session,
      and the page polls `POST /v1/ui/oauth/status {request}` every 2 seconds for the redirect.
      No other approval needs a code.
  - **Deny.** `POST /v1/ui/oauth/approve {request, deny: true}` (`owner.mcp-key.deny`) ends the
    request and answers `{redirect}` carrying `access_denied`. Closing the page is a silent
    denial: the request expires.
  - **Status.** `POST /v1/ui/oauth/status {request}` answers `{pending: true}`, `{redirect,
    repository, actions}` (again on every call until the code is redeemed or expires, so a lost
    answer is recoverable), `{expired: true}` or `{gone: true}` (denied, redeemed, or unknown).
  - **Who may approve.** `owner.oauth.request`, `owner.oauth.status`, `owner.mcp-key.approve` and
    `owner.mcp-key.deny` admit only an owner's dashboard session, on its own repositories. No
    key calls them, so no CLI or agent holding an owner key approves without a browser; an
    administrator's session is `forbidden`, having no owner key for a grant to die with. The
    grant's minting owner key is the one that minted the approving session.
  - **What consent cannot tell.** An owner who approves a link someone else sent connects that
    someone's client; Baton cannot see who began a request. The page's sentence, `client_addr`
    on the grant (§7) and the owners' listing are the defence. A teammate who is not an owner
    cannot be delegated to through OAuth.

## 6. The consent page and same-site

- **The consent page keeps R-BTN-16's rules whole.**
  - **`SameSite=Strict` stays.** A link from a client's site to `/oauth/authorize` is a
    cross-site navigation, which carries no Strict cookie. The page is therefore a static asset
    that reads no cookie and is the same for everyone; its own calls are same-origin `fetch`es
    and carry the cookie. No cookie is added or relaxed.
  - **Same-origin writes.** The `/v1/ui/oauth/*` routes are dashboard session routes: each
    requires `Content-Type: application/json`, an `Origin` equal to the origin and
    `Sec-Fetch-Site: same-origin` when sent (R-BTN-16), else `forbidden`. `approve` and `status`
    need the request handle, which only the page that opened the request holds; a request from
    another tab or session is `not-found`.
  - **No framing, no opener.** The page and every response carry `frame-ancestors 'none'` and
    `X-Frame-Options: DENY`; the page adds `Cross-Origin-Opener-Policy: same-origin`. Approve
    stays disabled until the page has been visible and focused for one second and a repository
    is chosen.
  - **Rendering.** Every server-supplied string reaches the screen through `textContent`
    (`BATON_SPEC` §12.3); hosts as A-labels (§3).
  - **The machine endpoints** (`token`, `register`, `revoke`) send no CORS headers, and refuse a
    request whose `Origin` is present and not the origin (`invalid_request`).
  - **Nothing leaks from the page.** `Referrer-Policy: no-referrer` keeps the query from
    leaving; the request handle never leaves page memory; the authorization code reaches only a
    registered redirect URI in this browser.

## 7. What a grant is

- **A grant is an MCP key, and nothing more.** The first successful redemption of an approved
  code writes one `mcp_keys` row. Everything R-BTN-130 says of an MCP key holds for it — one
  repository, ids fixed when it is made, authorization as its minting owner key within
  R-BTN-186, the `own` test by `id`, its lifetime and every way it ends — with these
  differences:
  - it has no `bmcp_` bearer (`key_hash` NULL) and is reached only through its tokens (§8);
  - it is created at the code's first redemption, not at approval, and records its `client_id`,
    `client_addr`, the approving session and the approval time;
  - its ids are the actions the owner ticked, by default `read` only, each write only when
    ticked;
  - it does not resume after `api_keys: false` (§9).
  - **Scopes are R-BTN-130's `--actions` spelled with spaces**: `read`, or any action id
    R-BTN-186 admits to a delegated key. The token response's `scope` lists the approved
    tokens.
  - **No step-up.** A tool the grant lacks is not listed, and calling it is `forbidden`
    (R-BTN-130), never a `403 insufficient_scope`. A client needing more re-authorizes into a
    new grant.
  - **Names.** The name defaults to the client's host (for a `bdc_` client the redirect URI's
    host, `localhost` for loopback), then `<host>-2`, …, at most 40 characters, unique among
    the repository's live grants, `bmcp_` keys and approved, unredeemed requests. Tokens and
    requests refer to the grant by `id`, never by name. Owners list grants with their keys:
    client host, minter, `client_addr` and approval time.

## 8. Tokens

- **Codes and tokens: short access, rotating refresh.**
  - **Authorization code.** 256 random bits, base64url; issued at approval; lives 60 seconds;
    bound to the request's `client_id`, `redirect_uri`, `code_challenge` and resource. Only a
    successful redemption consumes it. A wrong verifier counts on the code, and the third kills
    the code, never a grant. A consumed code presented again with the correct verifier is
    `invalid_grant` and revokes the grant it created; with a wrong one it is only
    `invalid_grant`.
  - **The token endpoint** (`POST /v1/oauth/token`, form-encoded; answers carry `Cache-Control:
    no-store`) answers `{access_token, token_type: "Bearer", expires_in, refresh_token, scope}`.
    - `authorization_code`: `code`, `redirect_uri` and `client_id` equal to the request's,
      `code_verifier`, optional `resource` (§4's check). Its first success creates the grant
      (§7) and its first tokens in one transaction, rechecking §10's grant cap, `api_keys` and
      that the repository is not retired (R-BTN-47).
    - `refresh_token`: `refresh_token`, `client_id` equal to the grant's, optional `scope`. The
      answer carries the grant's scope whatever is asked.
    - `invalid_grant`: an unknown, expired, killed or consumed code; a mismatch; a failed
      recheck; a dead grant; a reused refresh token. `unsupported_grant_type`: any other grant
      type. `invalid_scope`: a malformed scope string.
  - **Access token** `bmo_<id>_<secret>` (64 bits of id, 256 of secret): opaque, looked up and
    its grant checked on every call. It lives one hour, never past its grant's expiry, and is
    accepted only on `POST /v1/mcp` at its origin; elsewhere it is `unauthenticated`.
  - **Refresh token** `bmr_<id>_<secret>`: one family per grant with a generation counter,
    rotated on every use. Presenting a live token of the current generation `g` mints a token
    of `g+1` and marks the presented one used. It lives as long as its grant. A refresh is not
    an MCP call: it does not reset R-BTN-130's idle clock.
  - **Siblings and reuse.** A used generation-`g` token presented again within 60 seconds of its
    first use, while no `g+1` token has been used, mints another `g+1` sibling, at most three
    per generation. Siblings stay valid until one of them is used, which kills the rest. Any
    other presentation of a used or killed token is reuse: it revokes the grant and every token
    of it, records the act, and raises `baton.oauth-replay` (§9).
  - **Tenant binding** (R-BTN-137): codes, request handles and tokens are rows of one tenant,
    stored as SHA-256 hashes and compared in constant time; a token's grant names one
    repository of that tenant.

## 9. Revocation

- **A grant ends as an MCP key ends, and takes every token with it.**
  - Besides R-BTN-130's ends, a grant ends by code or refresh reuse (§8), RFC 7009 revocation,
    or a bearer crossing `http` (R-BTN-158, which adds `bmo_` and `bmr_` to its bearers). A
    repository's retirement (R-BTN-47) also ends its pending requests and codes. An act that
    ends a grant marks every token of it `revoked_at` in the same transaction.
  - **`api_keys: false`.** While it stands, access tokens are refused (`401` with the
    challenge) and refreshes and code exchanges are `invalid_grant`. The grant row is not ended,
    and idles out; the owner consents again once the setting returns.
  - `POST /v1/oauth/revoke` (RFC 7009) takes `token` and `client_id`; an access or refresh token
    of that client revokes its whole grant.
  - **Records.** Approval, denial, a grant's creation, every end and every reuse write a
    repository `events` row of kind `oauth` (`detail.act`: `approved`, `denied`, `granted`,
    `revoked`, `replay`, `code-failed`), actor the approving owner or `mcp:<id>`.
  - **`baton.oauth-replay`** (notify) sits on the repository with `detail` `{grant_id, client_id,
    kind: "code" | "refresh", client_addr}`; its cause ends when the revoked grant's row is
    deleted, or an owner resolves it.
  - **Retention.** The alarm deletes an expired or settled request at `expires_at`, an expired
    access token at `expires_at`, a used or killed refresh token 7 days after its use (later it
    is unknown: `invalid_grant`, no alarm), and an ended grant's row with all its tokens 90
    days after it ends; the owners' listing shows it as revoked until then.

## 10. Bounds and abuse

- **Bounds.** Per tenant (R-BTN-135):
  - **Per IP** (the per-IP rule, keyed `<host>|<ip>`, an IPv6 address by its `/64`): register
    20 an hour; token 120 a minute; revoke 60 a minute; the static page as any static asset.
    Past one, `429` with `Retry-After` and `{error: "temporarily_unavailable"}`.
  - **Session routes** count as the session's authenticated calls. At most five open requests
    per session; a sixth drops that session's oldest.
  - **Failed verifications.** `bmo_` and `bmr_` join R-BTN-135's failure buckets by their
    `<id>`. The token endpoint counts no failure in the (origin, client IP) bucket, since a
    hosted client's exchanges share one address: it relies on the per-IP limit, the per-code
    count (§8) and 256-bit secrets.
  - **Registered clients.** At most 500 in the tenant. One with no grant within 24 hours is
    deleted; at the cap a registration drops the oldest client with neither a grant nor an open
    request, else is `429`.
  - **Documents.** At most 30 uncached document fetches a minute per tenant, and one a minute
    per URL per tenant after a failure; past either, the last valid copy serves (§3).
  - **Grants.** At most 50 live OAuth grants per repository, approved unredeemed requests
    counted.
  - **Writes** are counted in R-BTN-149's budgets as the grant's and the repository's, and
    never refused by them.

## 11. Refusals

Each refusal is stated with its check, in §2–§10. The OAuth endpoints answer RFC 6749 §5.2's
`{error, error_description?}`, `400` unless noted, not Baton's `{ok: false, code}`; the
`/v1/ui/oauth/*` routes answer Baton's codes, and the page shows them.

## 12. Data model rows

For `BATON_SPEC` §13.2 (and `instance_settings` in §13.1). Bearers are stored as hashes
(`BATON_SPEC` §12.1), which adds `bmo_`, `bmr_` and `bor_`.

| Table | Key | Columns |
|---|---|---|
| `mcp_keys` (changed) | `id` (random, never reused); unique `(repository_id, name)` among live rows | `key_hash` NULL for an OAuth grant; adds `client_id` (NULL for a minted key), `client_addr`, `approved_session`, `approved_at`, `ended_at` |
| `oauth_clients` | `id` (`bdc_<id>`) | `redirect_uris` JSON, `client_name`, `application_type`, `created_at`, `created_addr`, `first_grant_at` |
| `oauth_requests` | `id` (of `bor_<id>_<secret>`) | `secret_hash`, `session_id`, `client_id`, `client_name`, `redirect_uri`, `state`, `code_challenge`, `requested` JSON, `client_addr`, `created_at`, `expires_at`; at approval `repository_id`, `actions` JSON, `ttl_days`, `name`, `approved_at`, `confirm_pending`, `auth_code_hash`, `auth_code_expires_at`, `auth_code_failures`; `denied_at`; at redemption `redeemed_at`, `mcp_key_id` |
| `oauth_tokens` | `id` (of `bmo_` or `bmr_`) | `kind` (`access`\|`refresh`), `secret_hash`, `repository_id`, `mcp_key_id`, `client_id`, `generation`, `created_at`, `expires_at`, `used_at`, `killed_at`, `revoked_at` |
| `instance_settings` (changed) | one row | adds `oauth_redirect_uris` JSON (§4) |

The alarm instants (`BATON_SPEC` §2.1) are §9's retention and §10's unused client;
`events.kind` adds `oauth`.

## 13. Routes

For `BATON_SPEC` §14. The consent page is a static dashboard asset, not an action (R-BTN-129).
Every other route is a registry entry with `delegated: false`.

| Route | Caller | Body or query | Response |
|---|---|---|---|
| `GET /.well-known/oauth-protected-resource/v1/mcp` | `public` | — | §2 |
| `GET /.well-known/oauth-authorization-server` | `public` | — | §2 |
| `GET /oauth/authorize` | none (static asset) | the authorization request | the consent page |
| `POST /v1/ui/oauth/requests` | an owner's session | `{query}` | §5 |
| `POST /v1/ui/oauth/approve` | an owner's session (§5) | §5 | §5 |
| `POST /v1/ui/oauth/status` | an owner's session | `{request}` | §5 |
| `POST /v1/oauth/token` | `public`: PKCE, or a refresh token | form (§8) | §8 |
| `POST /v1/oauth/register` | `public` | RFC 7591 JSON | `201` with `client_id` (§3) |
| `POST /v1/oauth/revoke` | `public` | form: `token`, `client_id` | `200`, always |
| `PUT /v1/admin/settings` (changed) | administrator | adds `oauth_redirect_uris` | `{ok: true}` |
| `POST /v1/mcp` (changed) | an MCP key, or an access token, as a bearer | as R-BTN-130 | `401` carries §2's challenge |

**Admission** (`BATON_SPEC` §2.3, R-BTN-16): `/oauth/authorize` is a static page needing no
session, as `/login` is; `/.well-known/oauth-*` and `/v1/oauth/*` are unauthenticated routes
under the per-IP rule; `/v1/ui/oauth/*` are session routes. A proxy that authenticates browsers
in front of the dashboard is bypassed on `/v1/mcp`, `/v1/oauth/*` and `/.well-known/*`, which
clients call without its cookie.

## 14. Scenario and gate

Rows for `BATON_SPEC` §15. S-BTN-137 is one scenario in four parts, one test file each
(`S-BTN-137.<part>.test.ts`).

| Scenario | Script | Expected |
|---|---|---|
| S-BTN-137 (1) connecting a client | a tokenless `POST /v1/mcp`; discovery; a document client with a loopback redirect, and a hosted one; the page opened by a cross-site navigation with an owner's session; an approval narrower than the request; the exchange; `tools/list`; a hold; a refresh; the redirect fetched again by `status` | §2's challenge and documents; `read` alone ticked; no `mcp_keys` row until the exchange (§7); only the approved tools; a rotated refresh token; the same redirect (§5) |
| (2) refused authorizations | every refusal of §4, §5 and §6; a wrong verifier three times, then the right one; a code redeemed and presented again with a wrong and then the right verifier; a destructive id before and after its confirmation code | each as its section says; no row and no document fetch without a session; no redirect before the client and redirect validate; the grant revoked only by the right verifier (§8) |
| (3) a grant's life | sibling refreshes and reuse (§8); every end of §9; a new grant taking an ended grant's name; a token on a REST route, at another tenant, over non-loopback `http` | as §8 and §9; the old tokens stay dead; `unauthenticated`; revoked and `baton.bearer-over-http` |
| (4) registration and abuse | every refusal of §3; every bound of §10 | as §3 and §10 |

| Gate | Invariant | Proved by |
|---|---|---|
| G-BTN-157 | (1) An OAuth token grants exactly what an MCP key of the approving owner key with the approved ids grants, and is accepted only on `POST /v1/mcp` at its origin (§7, §8). (2) A code issues only through an approval by the owner's session that opened the request, same-origin, and goes only to a redirect URI that passes §4 (§5, §6). (3) Codes, handles and tokens are stored only as hashes; a refresh family has one live generation, bar §8's siblings; ending a grant ends every token (§8, §9). (4) Baton fetches only a client document as §3 allows and nothing it links, issues and accepts no client secret, and keeps registrations within §10's caps | S-BTN-137 |

## Decisions

- Consent is standard OAuth consent on Baton's dashboard, by an owner signed in, in the browser
  that started the request (§5).
- The consent page is static and its same-origin calls carry the `SameSite=Strict` cookie; no
  cookie is added or relaxed (§6).
- An approval naming no destructive action needs no confirmation code (§5).
- A grant is an `mcp_keys` row created at the code's first redemption, its tokens naming it by
  `id` (§7).
- The challenge names every scope and consent defaults to `read`; no step-up (§2, §7).
- Access tokens are opaque and looked up on each call (§8).
- Refresh families have 60-second siblings (§8).
- Only a successful redemption consumes a code, and only the correct verifier revokes on reuse
  (§8).
- Client ID Metadata Documents first, bounded dynamic registration kept; public clients only
  (§3).
- Redirect URIs are exact and listed by an administrator, loopback always allowed (§4).
- No CORS (§2).
- `api_keys: false` makes OAuth clients consent again rather than resume (§9).

## Open questions

- **The default redirect URIs.** `oauth_redirect_uris` defaults to two callbacks so connecting
  needs no administrator step. The alternative is an empty default, loopback only.
- **A changed client document.** Baton checks a document at authorization only. Re-checking it
  at refresh, and ending grants whose redirect URIs it no longer lists, is deferred.
- **Non-owner teammates.** Delegating a grant to a teammate who is not an owner is deferred.
- **Enterprise-managed authorization** (an identity assertion with no consent screen) is not
  supported: every grant needs an owner's approval.

## Sources

- MCP specification, revision 2026-07-28, Authorization:
  [https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
- OAuth 2.1, [draft-ietf-oauth-v2-1-13](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13).
- [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636) (PKCE),
  [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414) (authorization server metadata),
  [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) (protected resource metadata),
  [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591) (dynamic registration),
  [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707) (resource indicators),
  [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207) (issuer identification),
  [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009) (revocation).
- RFC 6749 §5.2 (error responses), RFC 6750 §3 (`WWW-Authenticate`), RFC 8252 §7.3 (loopback
  redirects), RFC 9700 (security practice), RFC 6890 and RFC 8190 (special-purpose addresses).
- OAuth Client ID Metadata Document,
  [draft-ietf-oauth-client-id-metadata-document-02](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-02).
