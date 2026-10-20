---
title: "Baton — OAuth 2.1 for MCP clients: an owner-approved MCP key, obtained by the standard MCP authorization flow"
status: proposal
updated: 2026-10-20
---

# Baton as the authorization server for its own MCP endpoint

**Status:** proposal — a companion to `BATON_SPEC` (`spec/BATON_SPEC.md`), closing its open
question "OAuth for MCP clients (R-BTN-130)". Built by B-73, which folds this spec's §12 and §13 rows
into `BATON_SPEC` §13 and §14.

**Updated:** 2026-10-20

> **What this adds.** Today an owner mints an MCP key (`bmcp_…`, R-BTN-130) and pastes it into a
> client as a bearer. Claude's clients — claude.ai custom connectors, the Claude desktop and
> mobile apps, Cowork and Claude Code — and other MCP clients instead follow the MCP
> authorization flow: a `401` from the MCP endpoint, discovery, a browser authorization, PKCE, a
> token. This spec makes Baton the OAuth 2.1 authorization server for its own `POST /v1/mcp`,
> and makes every authorization it grants an MCP key: nothing here widens what MCP can reach.
> Ids continue `BATON_SPEC`'s: one requirement, R-BTN-172, whose parts are §2–§10; one scenario,
> S-BTN-137, in four parts; one gate, G-BTN-157. `§n` alone means this spec's section;
> `BATON_SPEC`'s are named as such.

## Contents

| § | Title | What it settles |
|---|---|---|
| 1 | The flow | the steps, end to end |
| 2 | Discovery | issuer, resource, the two metadata documents, the `401` |
| 3 | Clients | Client ID Metadata Documents, bounded dynamic registration, public clients only |
| 4 | The authorization request | parameters, redirect URIs, where errors go |
| 5 | Consent | the owner key approves a code Baton's page shows |
| 6 | The consent page and same-site | why there is nothing to frame, forge or steal |
| 7 | What a grant is | an `mcp_keys` row: R-BTN-130's scope exactly |
| 8 | Tokens | codes, access and refresh tokens, rotation and reuse |
| 9 | Revocation | every way a grant ends |
| 10 | Bounds and abuse | rate limits and caps |
| 11 | Refusals | every error and where it goes |
| 12 | Data model rows | for `BATON_SPEC` §13 |
| 13 | Routes | for `BATON_SPEC` §14 |
| 14 | Scenario and gate | S-BTN-137, G-BTN-157 |
| — | Decisions, Open questions, Sources | |

## 1. The flow

1. The client calls `POST <origin>/v1/mcp` with no token and gets `401` with a
   `WWW-Authenticate` pointing at the protected resource metadata (§2).
2. It reads that document, then the authorization server metadata at the same origin.
3. It identifies itself by a Client ID Metadata Document URL, or registers (§3).
4. It opens the browser at `<origin>/oauth/authorize` with PKCE (`S256`), `state`, `scope` and
   `resource` (§4).
5. Baton's page shows an eight-character code. An owner of the repository runs
   `baton owner mcp-key approve <repository> <code>`, reads what is asking and where it
   redirects, and approves with their owner key (§5).
6. The page redirects the browser to the client's registered redirect URI with an authorization
   code, `state` and `iss`.
7. The client exchanges the code and its PKCE verifier at `POST /v1/oauth/token` for a one-hour
   access token and a rotating refresh token (§8), both bound to one `mcp_keys` row
   (§7), and calls `POST /v1/mcp` with `Authorization: Bearer <access token>`.

## 2. Discovery

- **R-BTN-172 (Baton is the OAuth 2.1 authorization server of its own MCP endpoint).** One
  requirement, whose parts are this spec's §2–§10; code cites it as `R-BTN-172` and, where it
  helps, the part (`R-BTN-172 §8`). §2, discovery:
  - **Identifiers.** The issuer is the tenant's origin exactly (`BATON_ORIGIN`, no path, no
    trailing slash; R-BTN-135). The protected resource is `<origin>/v1/mcp`. No other
    authorization server is listed, and Baton accepts no token another server issued.
  - **Where it is served.** On an `https` origin, or a loopback `http` origin for development
    (Claude Code reaches it; hosted Claude does not). A non-loopback `http` origin serves none of
    this spec's routes (`404`), as it serves no dashboard (R-BTN-158).
  - **The challenge.** `POST /v1/mcp` with no bearer, or one that is unknown, expired or revoked,
    answers `401` with
    `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/v1/mcp", scope="read"`,
    adding `error="invalid_token"` when a bearer was sent. This replaces R-BTN-130's bare
    `Bearer` challenge, for `bmcp_` keys too. No `200` ever carries a challenge.
  - **Protected resource metadata** (RFC 9728), at
    `/.well-known/oauth-protected-resource/v1/mcp` and at `/.well-known/oauth-protected-resource`:
    `{resource: "<origin>/v1/mcp", authorization_servers: ["<origin>"], scopes_supported:
    ["read"], bearer_methods_supported: ["header"], resource_name: "Baton"}`.
  - **Authorization server metadata** (RFC 8414), at `/.well-known/oauth-authorization-server`:
    `issuer`, `authorization_endpoint` (`<origin>/oauth/authorize`), `token_endpoint`
    (`<origin>/v1/oauth/token`), `registration_endpoint` (`<origin>/v1/oauth/register`),
    `revocation_endpoint` (`<origin>/v1/oauth/revoke`), `response_types_supported: ["code"]`,
    `grant_types_supported: ["authorization_code", "refresh_token"]`,
    `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported:
    ["none"]`, `revocation_endpoint_auth_methods_supported: ["none"]`,
    `client_id_metadata_document_supported: true`,
    `authorization_response_iss_parameter_supported: true`, `scopes_supported: ["read",
    "ticket.hold", "leg.stop"]`. It lists no `offline_access`: every grant gets a refresh token.
  - `/.well-known/openid-configuration` is `404`: Baton issues no ID tokens. Both documents carry
    `Cache-Control: public, max-age=300` and are built from configuration, so they are equal on
    both hosts and change only with a deploy or the origin.

## 3. Clients

- **Clients are public, identified by a metadata document or a bounded registration.**
  - **Public clients only.** A client authenticates by PKCE alone (`token_endpoint_auth_method:
    none`). Baton never issues a client secret; a request carrying one, or an `Authorization`
    header at the token or revocation endpoint, is `invalid_client`.
  - **Client ID Metadata Documents** (the MCP revision's preferred mechanism; Claude uses it when
    the metadata advertises it and `none`). A `client_id` beginning `https://` is a document URL:
    - at most 512 characters, with a path and no userinfo, fragment, query, or `.` or `..`
      segment;
    - fetched by the Worker at the authorization request, never at the token endpoint: `GET`,
      no redirects followed, `200` only, at most 5 KB read, 5 s timeout, JSON;
    - never from a special-use address (RFC 6890): Cloudflare's `fetch` reaches public addresses
      only; the local host resolves the name, refuses a special-use address (loopback too,
      unless its own origin is loopback) and connects to the address it checked;
    - cached by its exact URL, deployment-wide (public data, R-BTN-135), honouring
      `Cache-Control` within 5 minutes to 24 hours; a failure or invalid document is not
      cached;
    - valid only if its `client_id` equals the URL byte for byte; `redirect_uris` holds 1–10
      entries, each passing §4's form; `token_endpoint_auth_method` is absent or `none`;
      `grant_types` is absent or within `authorization_code` and `refresh_token`;
      `response_types` is absent or `["code"]`; and no `client_secret` appears.
    - `client_name` is kept if it passes `BATON_SPEC` §12.3's free-text rule at 64 characters, else dropped.
      Baton fetches nothing the document links (`logo_uri`, `client_uri`, `policy_uri`,
      `tos_uri`, `jwks_uri`).
    - Claude Code's document is `https://claude.ai/oauth/claude-code-client-metadata`.
  - **Dynamic registration** (RFC 7591, `POST /v1/oauth/register`) stays for clients that lack
    the newer mechanism; the MCP revision deprecates it, and Claude falls back to it.
    - The body (JSON, at most 4 KB) needs `redirect_uris` (1–10, §4's form) and may carry
      `client_name`, `grant_types`, `response_types`, `application_type` and
      `token_endpoint_auth_method` (`none` only); others are ignored.
    - It answers `201` with `client_id` `bdc_<id>` (64 random bits, hex; never `https://…`),
      `client_id_issued_at` and the accepted metadata. There is no registration access token
      and no client configuration endpoint (RFC 7592).
  - **What a person is shown.** A document client is named by its URL's host (`claude.ai`); a
    registered client as "registered client, unverified". `client_name` is always shown as
    self-declared, and the redirect URI's host always beside it.

## 4. The authorization request

- **The authorization request and its redirect URI.**
  - **Parameters.** `GET /oauth/authorize` serves the consent page, which changes nothing and
    sends its query to `POST /v1/oauth/requests`. Baton checks, in this order:
    1. `client_id` is a valid document URL whose document validates, or a stored `bdc_` id;
    2. `redirect_uri` is present and matches one of the client's;
    3. `response_type` is `code`;
    4. `code_challenge` is 43–128 base64url characters and `code_challenge_method` is `S256`
       (absent or `plain` is refused);
    5. `scope` is space-separated tokens of §7's set (absent means `read`;
       `offline_access` is dropped);
    6. `resource`, if present, equals `<origin>/v1/mcp`, scheme and host compared without case;
    7. `state`, if present, is at most 512 characters of `%x20-7E`, returned unchanged.

    A repeated parameter is `invalid_request`; unknown parameters are ignored.
  - **Redirect URIs.** A requested URI matches a registered one by exact string comparison,
    except loopback: `http://127.0.0.1`, `http://[::1]` and `http://localhost` match with the
    port ignored (RFC 8252 §7.3; Claude Code declares `localhost`). Any other registered URI is
    `https`, with no userinfo or fragment, at most 512 characters, on a host the administrator
    lists in `oauth_redirect_hosts` (an instance setting beside `link_hosts`; exact hosts; default
    `["claude.ai", "claude.com"]`; empty allows loopback only). Hosted Claude's callback is
    `https://claude.ai/api/mcp/auth_callback`; Anthropic has said it may move to `claude.com`.
  - **Where errors go.** Until steps 1 and 2 pass, an error is shown on Baton's page and never
    redirected (OAuth 2.1 §4.1.2.1). After them, the page sends the browser to the redirect URI
    with `error`, `state` and `iss`.
  - **Success** sends the browser to the redirect URI with `code`, `state` and `iss=<origin>`
    (RFC 9207).

## 5. Consent

- **An owner's key approves a code Baton's page shows.**
  - **The request.** `POST /v1/oauth/requests` writes an `oauth_requests` row living 10 minutes
    and answers `{code, poll, client, redirect_host, scope, expires_at}`: `code` is eight
    Crockford base32 characters, as R-BTN-155's; `poll` is `bor_<id>_<secret>`, kept only in the
    page's memory. The page shows the code, what is asking, where it redirects, and the command
    `baton owner mcp-key approve <repository> <code>`.
  - **The approval.** Any owner of the repository runs `baton owner mcp-key approve <repository>
    <code> [--actions read | <id>,…] [--ttl <days>] [--name <name>] [--deny]`, which calls
    `owner.mcp-key.approve` (`POST /v1/owner/{repository}/oauth/approve`):
    1. `{code, dry_run: true}` returns the client's identity (§3), the redirect URI, the
       requested scope, the requesting address and the request's age; the CLI prints them, warns
       for a loopback redirect ("the code goes to whatever program listens on that port of the
       machine whose browser opened the page"), and asks.
    2. `{code, actions?, ttl?, name?, confirm: true}` mints the grant (§7) and an
       authorization code (§8) in one transaction; `{code, deny: true}` ends the request
       with `access_denied`.

    The owner key signs (an `sk-` key needs a touch) or is sent as the owner's API key
    (R-BTN-159). `owner.mcp-key.approve`'s `callers` are exactly `[owner]`, as
    `owner.mcp-key.create`'s are: no dashboard session, administrator or MCP key approves, so
    every grant has a minting owner key to die with.
  - **Delivery.** The page polls `POST /v1/oauth/requests/poll {poll}` every 2 seconds:
    `{pending: true}`, then `{redirect}` once, which it navigates to. Only the poll secret of the
    approved row gets the redirect, so a code read over a shoulder gives its reader nothing.
  - **Who may be at the browser.** Anyone: a teammate shows an owner the code. The owner then
    delegates to that person's client, within the owner's own authority and the scope they
    approve; the CLI says so before asking.

## 6. The consent page and same-site

- **The consent page has nothing to frame, forge or steal.** R-BTN-16's rules hold
  on every route here, and:
  - **No control on the page grants anything.** It renders text through `textContent` (`BATON_SPEC` §12.3)
    and offers only Cancel (`{poll, cancel: true}`, which redirects with `access_denied`). A
    framed or overlaid page has nothing to click into a grant; every response still carries
    `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
  - **No cookie.** These routes set and read none; R-BTN-16's two cookies stay the only ones,
    and a dashboard session is neither needed nor read, so no session can be ridden into a
    grant.
  - **Same-origin writes.** `POST /v1/oauth/requests` and `…/poll` require `Content-Type:
    application/json` and an `Origin` equal to the origin, else `forbidden`, so no other origin
    on the registrable domain can open or poll a request.
  - **The machine endpoints** (`token`, `register`, `revoke`) are called by servers and native
    clients: they send no CORS headers, and refuse a request whose `Origin` is present and not
    the origin (`invalid_request`).
  - **Nothing leaks from the page.** `Referrer-Policy: no-referrer` keeps the query from leaving;
    the code is useless without an owner key; the poll secret never leaves page memory; the
    authorization code reaches only a registered redirect URI and is useless without the PKCE
    verifier. A same-site origin running untrusted code is a redirect target only if an
    administrator lists its host.

## 7. What a grant is

- **A grant is an MCP key, and nothing more.**
  - An approval writes one `mcp_keys` row with no `bmcp_` bearer (`key_hash` NULL) and its
    `client_id`. Everything R-BTN-130 and R-BTN-154 say of an MCP key holds for it:
    - one repository, the one the owner named;
    - action ids resolved at approval from `--actions`, default the requested scope; never wider
      than the requested scope, R-BTN-130's allowlist or the owner's own actions (else
      `invalid-params`);
    - authorized as its minting owner on that repository, narrowed to its ids, only on
      `POST /v1/mcp`; a hold only adds (`hold_reason: mcp:<name>`), and `leg.stop` only when
      listed by id;
    - at most 90 days (default 30), ended by 7 days without an MCP call, its minter's removal
      or revocation, or `owner.mcp-key.revoke`; refused while the repository has
      `api_keys: false`.
  - **Scopes are `--actions` spelled with spaces**: `read` (the allowlisted reads existing at
    approval), `ticket.hold`, `leg.stop`, or any allowlisted read id. The token response's
    `scope` lists the approved tokens.
  - **No step-up.** A tool the grant lacks is not listed, and calling it is `forbidden`
    (R-BTN-130), never a `403 insufficient_scope`: Baton offers no existence oracle. A client
    needing more re-authorizes into a new grant.
  - The name defaults to the client's host (`claude.ai`, then `claude.ai-2`, …), at most 40
    characters, unique in the repository. Owners list grants with their keys, client host and
    minter.

## 8. Tokens

- **Codes and tokens: short access, rotating refresh.**
  - **Authorization code.** 256 random bits, base64url; lives 60 seconds; used once; bound to
    the request's `client_id`, `redirect_uri`, `code_challenge` and resource. A second
    presentation is `invalid_grant` and revokes the grant (OAuth 2.1 §4.1.3).
  - **The token endpoint** (`POST /v1/oauth/token`, `application/x-www-form-urlencoded`; answers
    carry `Cache-Control: no-store`):
    - `grant_type=authorization_code` with `code`, `redirect_uri` (equal to the request's),
      `client_id` (equal), `code_verifier` (43–128 unreserved characters, whose `S256` is the
      challenge) and optional `resource` (§4's check);
    - `grant_type=refresh_token` with `refresh_token`, `client_id` (equal to the grant's) and
      optional `scope`, which must equal the grant's (else `invalid_scope`);
    - answer `{access_token, token_type: "Bearer", expires_in, refresh_token, scope}`.
  - **Access token** `bmo_<id>_<secret>` (64 bits of id, 256 of secret): opaque, looked up and
    its grant checked on every call, so revocation is immediate. It lives one hour, never past
    its grant's expiry, and is accepted only on `POST /v1/mcp` at its origin; elsewhere it is
    `unauthenticated` (R-BTN-130).
  - **Refresh token** `bmr_<id>_<secret>`: rotated on every use (OAuth 2.1 §4.3.1); the presented
    one dies and its successor is returned. It lives as long as its grant. An access token
    already issued lives out its hour.
  - **Reuse.** A rotated refresh token presented again within 60 seconds of its rotation, while
    its successor has never been presented, is a lost response (Claude waits 30 s on a refresh):
    it rotates once more and the unused successor dies. Any other reuse revokes the grant and
    every token of it, records the act, and raises `baton.oauth-replay` (notify) on the
    repository.
  - A refresh is not an MCP call: it does not reset R-BTN-130's 7-day idle clock.
  - **Tenant binding** (R-BTN-137): codes, poll secrets, tokens and `bdc_` ids are rows of one
    tenant, stored as SHA-256 hashes and compared in constant time, unknown to any other; a
    token's grant names one repository of that tenant; the issuer and resource are the origin's,
    and `iss` in every authorization response lets a client detect a mix-up.

## 9. Revocation

- **A grant ends as an MCP key ends, and takes every token with it.**
  - Every token dies at its next use when its `mcp_keys` row ends: `owner.mcp-key.revoke` by
    name, the minter's removal or revocation, expiry, 7 idle days, refresh reuse (§8), or
    a bearer crossing `http` (R-BTN-158, which adds `bmo_` and `bmr_` to its bearers). While
    `api_keys` is `false` the grant is refused, and works again when it returns, unless ended.
  - `POST /v1/oauth/revoke` (RFC 7009) takes `token` and `client_id`; an access or refresh token
    of that client revokes its whole grant. It always answers `200`.
  - The row keeps `revoked_at` for the owners' listing; the alarm deletes expired requests,
    codes and tokens.

## 10. Bounds and abuse

- **Bounds.** Per tenant, as everything is (R-BTN-135):
  - **Per IP** (the per-IP rule, keyed `<host>|<ip>`): register 20 an hour; authorization
    requests 10 a minute; token 120 a minute; revoke 60 a minute. Past one, `429` with
    `Retry-After`. Hosted Claude calls from one shared egress range (`160.79.104.0/21`), so the
    token limit is sized for a team's clients behind one address.
  - **Failed verifications.** `bmo_`, `bmr_` and `bor_` join R-BTN-135's failure buckets by their
    `<id>`; a wrong verifier or an unknown code counts in (origin, client IP).
  - **Unbound requests.** At most five per client address, each living 10 minutes; a sixth drops
    the oldest (it never refuses); at most 200 in the tenant, past which `429`.
  - **Registered clients.** At most 500 in the tenant. One with no approved grant within 24 hours
    is deleted; at the cap a registration drops the oldest such one. A client with a live grant
    is never dropped.
  - **Documents.** At most 30 uncached document fetches a minute per tenant, and one a minute per
    URL after a failure.
  - **Grants.** At most 20 live OAuth grants per repository; the 21st approval is `quota`.

## 11. Refusals

The OAuth endpoints answer as OAuth clients parse — RFC 6749 §5.2's `{error, error_description?}`,
`400` unless noted — not Baton's `{ok: false, code}`; the owner route answers Baton's codes.

| Where | Case | Answer |
|---|---|---|
| authorization, shown on the page | unknown or invalid `client_id`; a document that fails §3; a `redirect_uri` absent, unregistered or not allowed | `invalid_client` or `invalid_request`, never redirected |
| authorization, redirected | `response_type` not `code` | `unsupported_response_type` |
| | no `code_challenge`, method `plain`, a repeated or malformed parameter | `invalid_request` |
| | a scope token outside §7's set | `invalid_scope` |
| | a foreign `resource` | `invalid_target` (RFC 8707) |
| | the owner denies, Cancel, or 10 minutes pass | `access_denied` |
| any OAuth route | past a §10 limit | `429` with `Retry-After`; the page shows it |
| token | an unknown, expired or used code; a verifier, `redirect_uri` or `client_id` that does not match; a dead grant; a reused refresh token | `invalid_grant` |
| | a client secret or an `Authorization` header | `invalid_client` (`401`) |
| | a grant type other than the two | `unsupported_grant_type` |
| | a `scope` other than the grant's; a foreign `resource` | `invalid_scope`; `invalid_target` |
| register | a bad redirect URI; any other bad metadata, a confidential method | `invalid_redirect_uri`; `invalid_client_metadata` |
| `owner.mcp-key.approve` | an unknown, expired or settled code | `not-found` |
| | not an owner of the repository; `api_keys: false` | `forbidden` |
| | ids beyond the scope, the allowlist or the owner's actions; `--ttl` over 90 | `invalid-params` |
| | a name in use; a 21st grant; no `confirm` | `conflict`; `quota`; `confirm-required` |
| `POST /v1/mcp` | no, unknown, expired or revoked bearer | `401` with §2's challenge |
| | a foreign `Origin`; a tool the grant lacks | `403`; tool error `forbidden` (R-BTN-130) |

## 12. Data model rows

For `BATON_SPEC` §13.2 (and `instance_settings` in §13.1). Hashes only (`BATON_SPEC` §12.1's bearer rule).

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `mcp_keys` (changed) | `(repository_id, name)` | `key_hash` NULL for an OAuth grant; adds `client_id` (a document URL or `bdc_` id; NULL for a minted key) | R-BTN-130, R-BTN-172 |
| `oauth_clients` | `id` (`bdc_<id>`) | `redirect_uris` JSON (≤ 10), `client_name`, `application_type`, `created_at`, `created_addr`, `first_grant_at` | Registered clients; deleted unused after 24 h (R-BTN-172) |
| `oauth_requests` | `id` (of `bor_<id>_<secret>`) | `poll_hash`, `code_hash` (the consent code), `client_id`, `client_name`, `redirect_uri`, `state`, `code_challenge`, `scope` JSON, `client_addr`, `created_at`, `expires_at` (+10 min), `polled_at`, `repository_id`, `mcp_key` (set at approval), `denied_at`, `auth_code_hash`, `auth_code_expires_at` (+60 s), `auth_code_used_at` | A pending or settled authorization (R-BTN-172) |
| `oauth_tokens` | `id` (of `bmo_` or `bmr_`) | `kind` (`access`\|`refresh`), `secret_hash`, `repository_id`, `mcp_key`, `client_id`, `parent_id` (the refresh token it came from), `created_at`, `expires_at`, `rotated_at`, `successor_id`, `revoked_at` | R-BTN-172; deleted after expiry |
| `instance_settings` (changed) | one row | adds `oauth_redirect_hosts` JSON (default `["claude.ai", "claude.com"]`) | R-BTN-172 |

## 13. Routes

For `BATON_SPEC` §14. Each is a registry entry (R-BTN-129): the metadata, page, request, poll,
token, register and revoke entries list `public`; `owner.mcp-key.approve` lists exactly `[owner]`
and is never `mcp: true`.

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `GET /.well-known/oauth-protected-resource/v1/mcp`, `GET /.well-known/oauth-protected-resource` | none | — | the protected resource metadata | R-BTN-172 |
| `GET /.well-known/oauth-authorization-server` | none | — | the authorization server metadata | R-BTN-172 |
| `GET /oauth/authorize` | none | the authorization request | the consent page (static) | R-BTN-172 |
| `POST /v1/oauth/requests` | none; same-origin JSON | the request's parameters as an object | `{code, poll, client, redirect_host, scope, expires_at}`; or `{error, redirect?}` | R-BTN-172 |
| `POST /v1/oauth/requests/poll` | the poll secret; same-origin JSON | `{poll}` or `{poll, cancel: true}` | `{pending: true}`; then `{redirect}` once | R-BTN-172 |
| `POST /v1/owner/{repository}/oauth/approve` | owner | `{code, dry_run: true}`; `{code, actions?, ttl?, name?, confirm: true}`; `{code, deny: true}` | the dry run's `{client, redirect_uri, scope, client_addr, age_s}`; `{name}` | R-BTN-172 |
| `POST /v1/oauth/token` | a public client: PKCE, or its refresh token | form: §8's | the token response | R-BTN-172 |
| `POST /v1/oauth/register` | none | RFC 7591 JSON | `201` with `client_id` | R-BTN-172 |
| `POST /v1/oauth/revoke` | a public client | form: `token`, `client_id` | `200` | R-BTN-172 |
| `PUT /v1/admin/settings` (changed) | admin | adds `oauth_redirect_hosts` | `{ok: true}` | R-BTN-172 |
| `POST /v1/mcp` (changed) | an MCP key, or an OAuth access token, as a bearer | as R-BTN-130 | `401` carries R-BTN-172's challenge | R-BTN-130, R-BTN-172 |

**Admission** (`BATON_SPEC` §2.3): the Worker treats `/oauth/*`, `/.well-known/*` and
`/v1/oauth/*` as unauthenticated routes under the per-IP rule, and fetches client documents
before forwarding; codes, verifiers and tokens are checked inside the object.

## 14. Scenario and gate

Rows for `BATON_SPEC` §15, under its §11 heading. S-BTN-137 is one scenario in four parts, one
test file each (`S-BTN-137.<part>.test.ts`).

| Scenario | Script | Expected |
|---|---|---|
| S-BTN-137 MCP clients through OAuth: (1) connecting Claude | a tokenless `POST /v1/mcp`; discovery; Claude Code's document with `http://localhost:3118/callback`, and hosted Claude's callback; the owner approves `read ticket.hold` from a request for `read ticket.hold leg.stop`; the exchange; `tools/list`; a hold; a refresh | `401` with the challenge; both documents as §2; a code on the page; redirect with `code`, `state`, `iss`; tokens; only the approved tools; `held` with `mcp:<name>`; a rotated refresh token |
| (2) refused authorizations | `plain` and absent challenges; an unregistered, non-allowlisted and fragment redirect; a foreign `resource`; an unknown scope; a wrong verifier; a code used twice and after 60 s; a denial; an expired request; a non-owner's and an `api_keys: false` approval; a widened `--actions`; a framed page; a foreign `Origin` on a request | each as §11; no redirect before the client and redirect validate; the second code use revokes the grant; nothing on the page grants |
| (3) a grant's life | a refresh replayed within 60 s with an unused successor, then again; an access token past an hour; 8 idle days; the minter revoked; `api_keys: false` and back; `owner.mcp-key.revoke`; RFC 7009 revoke; a token on a REST route, at another tenant, over non-loopback `http` | one more rotation, then the grant revoked and `baton.oauth-replay`; `401`; dead; dead; refused then working; dead at the next call; dead; `unauthenticated`; `401`; revoked and `baton.bearer-over-http` |
| (4) registration and abuse | registration with `client_secret_basic`, 11 redirect URIs, a 21st in an hour from one IP, at 500 clients; an unused client after 24 h; documents over 5 KB, redirected, on a private address, with a mismatched `client_id`, with a secret method; a sixth unbound request from one address | `invalid_client_metadata`; `invalid_redirect_uri`; `429`; the oldest unused dropped; deleted; each refused on the page, nothing cached, no linked URL fetched; the oldest request dropped |

| Gate | Invariant | Proved by |
|---|---|---|
| G-BTN-157 | (1) An OAuth token grants exactly what an MCP key of the approving owner with the approved ids grants — one repository, ids within the request's scope, R-BTN-130's allowlist and the owner's actions, holds only added — and is accepted only on `POST /v1/mcp` at its origin. (2) No code or token issues without an owner key's approval of a code Baton's own page showed, an `S256` challenge and a redirect URI matching the client's under §4; the page has no control that grants. (3) Codes, poll secrets and tokens are stored only as hashes; a code works once within 60 s; a refresh token works once, bar the lost-response window, and reuse ends the grant; ending the `mcp_keys` row ends every token at its next use. (4) Baton fetches only an `https` client document at a public address, without redirects, at most 5 KB, and nothing it links; it never issues or accepts a client secret; registrations stay within §10's caps | S-BTN-137 |

## Decisions

- Chose consent by the owner key on a code Baton's page shows over an Approve button in an
  owner's dashboard session (R-BTN-155): a grant mints a credential, which R-BTN-155 confirms with
  the key anyway; the page then holds no cookie and no control to forge or frame, and
  `owner.mcp-key.*` stays owner-key only (2026-10-20; R-BTN-172 §5, §6).
- Chose a grant that is an `mcp_keys` row, its tokens hanging from it, over OAuth grants with an
  authority of their own: one authorization path, one listing, one revocation (2026-10-20;
  R-BTN-172 §7).
- Chose scopes that are R-BTN-130's `--actions` and no step-up challenge, so no `403` reveals a
  tool (2026-10-20; R-BTN-172 §7).
- Chose opaque access tokens looked up on each call over JWTs: Baton is its own resource server,
  and revocation is immediate (2026-10-20; R-BTN-172 §8).
- Chose rotating refresh tokens with a 60-second lost-response window, any other reuse ending the
  grant, over strict single use, which a timed-out refresh would turn into a lost grant
  (2026-10-20; R-BTN-172 §8).
- Chose Client ID Metadata Documents first and dynamic registration kept, bounded, for older
  clients; public clients only (2026-10-20; R-BTN-172 §3).
- Chose redirect hosts an administrator lists, loopback always allowed, over any `https` host:
  consent phishing then needs an allowed host (2026-10-20; R-BTN-172 §4).

## Open questions

- **The default redirect hosts.** `oauth_redirect_hosts` defaults to Claude's two hosts so
  connecting Claude needs no administrator step. The alternative is an empty default, loopback
  only, with the administrator adding hosts.
- **A changed client document.** Baton checks a document at authorization only. Re-checking it
  at refresh, and ending grants whose redirect URIs it no longer lists, is deferred until a client
  needs it.
- **Enterprise-managed authorization.** Claude's identity-assertion flow for organisations
  (no consent screen) is not supported: every grant needs an owner's approval.

## Sources

- MCP specification, revision 2026-07-28, Authorization:
  <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>, and its pages
  Authorization Server Discovery, Client Registration and Security Considerations (same path).
- OAuth 2.1, draft-ietf-oauth-v2-1-13: <https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13>.
- RFC 7636 (PKCE): <https://www.rfc-editor.org/rfc/rfc7636>.
- RFC 8414 (Authorization Server Metadata): <https://www.rfc-editor.org/rfc/rfc8414>.
- RFC 9728 (Protected Resource Metadata): <https://www.rfc-editor.org/rfc/rfc9728>.
- RFC 7591 (Dynamic Client Registration): <https://www.rfc-editor.org/rfc/rfc7591>.
- RFC 8707 (Resource Indicators): <https://www.rfc-editor.org/rfc/rfc8707>.
- RFC 9207 (Issuer Identification): <https://www.rfc-editor.org/rfc/rfc9207>.
- RFC 7009 (Token Revocation): <https://www.rfc-editor.org/rfc/rfc7009>.
- RFC 6749 §5.2 (error responses), RFC 6750 §3 (`WWW-Authenticate`), RFC 8252 §7.3 (loopback
  redirects), RFC 9700 (OAuth security BCP), RFC 6890 (special-use addresses).
- OAuth Client ID Metadata Document, draft-ietf-oauth-client-id-metadata-document-02 (July 2026):
  <https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-02>.
- Anthropic, "Authentication for connectors": <https://claude.com/docs/connectors/building/authentication>
  (callback `https://claude.ai/api/mcp/auth_callback`, a possible move to `claude.com`, CIMD only
  with `none` advertised, port-agnostic loopback, refresh rotation and `invalid_grant`, 10 s and
  30 s timeouts, egress `160.79.104.0/21`).
- Anthropic, "Lazy authentication for MCP servers": <https://claude.com/docs/connectors/building/lazy-authentication>
  (the `401` shape, `insufficient_scope` step-up, discovery caching).
- Claude Code's Client ID Metadata Document: <https://claude.ai/oauth/claude-code-client-metadata>.
- Anthropic support, "Building custom connectors via remote MCP servers":
  <https://support.claude.com/en/articles/11503834>.
