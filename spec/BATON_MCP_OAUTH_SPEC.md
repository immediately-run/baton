---
title: "Baton — OAuth 2.1 for MCP clients: an owner-approved MCP key, obtained by the standard MCP authorization flow"
status: proposal
updated: 2026-10-20
---

# Baton as the authorization server for its own MCP endpoint

**Status:** proposal — a companion to `BATON_SPEC` (`spec/BATON_SPEC.md`), which R-BTN-130 points
at for clients that cannot send a bearer. Built by B-73, which folds R-BTN-172 into `BATON_SPEC`
§11.3 and this spec's §12, §13 and §14 rows into `BATON_SPEC` §13, §14 and §15. Revised
2026-10-20 after its adversarial review: consent moved from an owner key approving a code to
standard OAuth consent on Baton's dashboard (Decisions).

**Updated:** 2026-10-20

> **What this adds.** Today an owner mints an MCP key (`bmcp_…`, R-BTN-130) and pastes it into a
> client as a bearer. Claude's clients — claude.ai custom connectors, the Claude desktop and
> mobile apps, Cowork and Claude Code — and other MCP clients instead follow the MCP
> authorization flow: a `401` from the MCP endpoint, discovery, a browser authorization, PKCE, a
> token. This spec makes Baton the OAuth 2.1 authorization server for its own `POST /v1/mcp`,
> and makes every authorization it grants an MCP key: nothing here widens what MCP can reach.
> An owner consents on Baton's own dashboard, signed in (R-BTN-155), in the browser that
> started the request.
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
| 5 | Consent | an owner's dashboard session approves, in the browser that asked |
| 6 | The consent page and same-site | `SameSite=Strict`, framing, forgery, what is shown |
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
4. It opens a browser at `<origin>/oauth/authorize` with PKCE (`S256`), `state`, `scope` and
   `resource` (§4).
5. Baton's consent page, in that browser, reads the owner's dashboard session (R-BTN-155) by a
   same-origin request; without one it asks the owner to sign in there. It shows the client,
   its redirect URI and the requested actions; the owner picks a repository, approves (or
   narrows) the actions, or denies (§5, §6).
6. The page sends the browser to the client's registered redirect URI with an authorization
   code, `state` and `iss`.
7. The client exchanges the code and its PKCE verifier at `POST /v1/oauth/token` for a one-hour
   access token and a rotating refresh token (§8). The exchange creates the grant, one
   `mcp_keys` row (§7); the client calls `POST /v1/mcp` with `Authorization: Bearer <access
   token>`.

## 2. Discovery

- **R-BTN-172 (Baton is the OAuth 2.1 authorization server of its own MCP endpoint).** One
  requirement, whose parts are this spec's §2–§10; code cites it as `R-BTN-172` and, where it
  helps, the part (`R-BTN-172 §8`). §2, discovery:
  - **Identifiers.** The issuer is the tenant's origin exactly (`BATON_ORIGIN`, no path, no
    trailing slash; R-BTN-135). The protected resource is `<origin>/v1/mcp`. No other
    authorization server is listed, and Baton accepts no token another server issued.
  - **Where it is served.** On an `https` origin, or a loopback `http` origin for development
    only (Claude Code reaches it; hosted Claude does not). The loopback origin deviates from the
    MCP revision's "every authorization server endpoint over HTTPS", as the Client ID Metadata
    Document draft (-02 §8.6) permits for development. A non-loopback `http` origin serves none
    of this spec's routes (`404`), as it serves no dashboard (R-BTN-158).
  - **The challenge.** `POST /v1/mcp` with no bearer, or one that is unknown, expired, revoked
    or refused, answers `401` with
    `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/v1/mcp", scope="read ticket.hold leg.stop"`,
    adding `error="invalid_token"` when a bearer was sent. The scope names every action MCP can
    reach, because clients request exactly the challenge's scope and offer no choice; the owner
    narrows it at consent (§5). This replaces R-BTN-130's bare `Bearer` challenge, for `bmcp_`
    keys too. No `200` ever carries a challenge.
  - **Protected resource metadata** (RFC 9728), at
    `/.well-known/oauth-protected-resource/v1/mcp` only (the root document is `404`: its
    `resource` would have to be the bare origin, RFC 9728 §3.3):
    `{resource: "<origin>/v1/mcp", authorization_servers: ["<origin>"], scopes_supported:
    ["read", "ticket.hold", "leg.stop"], bearer_methods_supported: ["header"], resource_name:
    "Baton"}`.
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
  - **No CORS.** Neither the documents nor the machine endpoints send CORS headers, and the
    documents keep R-BTN-16's `Cross-Origin-Resource-Policy: same-origin`, so an MCP client
    running in a browser page (an inspector, a single-page app) cannot use Baton (Decisions).

## 3. Clients

- **Clients are public, identified by a metadata document or a bounded registration.**
  - **Public clients only.** A client authenticates by PKCE alone (`token_endpoint_auth_method:
    none`). Baton never issues a client secret; a request carrying one, or an `Authorization`
    header at the token or revocation endpoint, is `invalid_client`.
  - **Identifier form.** A `client_id` and every redirect URI are RFC 3986 ASCII, with no space
    or control character, and equal to their own parsed-and-reserialized form; anything else is
    refused, so what a person is shown is what is matched.
  - **Client ID Metadata Documents** (the MCP revision's preferred mechanism; Claude uses it when
    the metadata advertises it and `none`). A `client_id` beginning `https://` is a document URL:
    - at most 512 characters, with a path and no userinfo, fragment, query, or `.` or `..`
      segment; its host is neither this deployment's own host nor any tenant host it serves
      (R-BTN-135: nothing crosses a tenant);
    - fetched by the Worker only for a consent page with an owner's session (§5), never at the
      token endpoint: `GET`, no redirects followed, `200` only, at most 5 KB read, 5 s timeout,
      JSON;
    - never from an address the IANA special-purpose registries mark not globally reachable
      (RFC 6890 as updated by RFC 8190, IPv4-mapped IPv6 and NAT64 `64:ff9b::/96` included):
      Cloudflare's `fetch` reaches public addresses only (B-73's manual check confirms it for
      Cloudflare-proxied hosts); the local host resolves the name, refuses such an address
      (loopback too, unless its own origin is loopback) and connects to the address it checked,
      keeping SNI and certificate validation against the hostname;
    - cached by its exact URL, deployment-wide (public data, R-BTN-135), honouring
      `Cache-Control` within 5 minutes to 24 hours, one hour when absent (Claude Code's sends
      none); a failure or invalid document is not cached, and a re-fetch that fails or is over
      §10's budget serves the last valid copy for up to 7 days;
    - valid only if its `client_id` equals the URL byte for byte; `redirect_uris` holds 1–10
      entries, of which those failing §4's form are ignored and at least one passes;
      `token_endpoint_auth_method` is absent or `none`; `grant_types` is absent or within
      `authorization_code` and `refresh_token`; `response_types` is absent or `["code"]`; and no
      `client_secret` appears.
    - `client_name` is kept if it passes `BATON_SPEC` §12.3's free-text rule at 64 characters and
      holds no format character (Unicode Cf: bidirectional controls, zero-width characters), else
      dropped. Baton fetches nothing the document links (`logo_uri`, `client_uri`, `policy_uri`,
      `tos_uri`, `jwks_uri`).
    - Claude Code's document is `https://claude.ai/oauth/claude-code-client-metadata`.
  - **Dynamic registration** (RFC 7591, `POST /v1/oauth/register`) stays for clients that lack
    the newer mechanism; the MCP revision deprecates it, and Claude falls back to it.
    - The body (JSON, at most 4 KB) needs `redirect_uris` (1–10, each passing §4's form) and may
      carry `client_name` (as above), `grant_types`, `response_types`, `application_type` and
      `token_endpoint_auth_method` (`none` only); others are ignored.
    - It answers `201` with `client_id` `bdc_<id>` (64 random bits, hex; never `https://…`;
      public, stored as is), `client_id_issued_at`, `token_endpoint_auth_method: "none"` stated
      explicitly (RFC 7591's default is `client_secret_basic`) and the accepted metadata. There
      is no registration access token and no client configuration endpoint (RFC 7592).
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
       stored `bdc_` id;
    2. `redirect_uri` appears once and matches one of the client's;
    3. no other parameter repeats; `response_type` is `code`;
    4. `code_challenge` is exactly 43 base64url characters (an `S256` digest) and
       `code_challenge_method` is `S256` (absent or `plain` is refused);
    5. `scope` is space-separated tokens of §7's set (absent means `read`; `offline_access` is
       dropped);
    6. `resource`, if present, equals `<origin>/v1/mcp`, scheme and host compared without case;
    7. `state`, if present, is at most 512 characters of `%x20-7E`, returned unchanged.

    Unknown parameters are ignored.
  - **Redirect URIs.** A requested URI matches a registered one by exact string comparison,
    except loopback: on `http://127.0.0.1`, `http://[::1]` and `http://localhost` the port is
    ignored and the rest compared exactly (RFC 8252 §7.3; Claude Code declares `localhost` and
    `127.0.0.1` at `/callback`). Any other registered URI is `https`, with no userinfo or
    fragment, at most 512 characters, and listed exactly in `oauth_redirect_uris` (an instance
    setting beside `link_hosts`; exact URIs; default
    `["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]`;
    empty allows loopback only). Hosted Claude's callback is
    `https://claude.ai/api/mcp/auth_callback`; Anthropic's support article says it may move to
    `claude.com`.
  - **Where errors go.** Until steps 1 and 2 pass, an error is shown on Baton's page and never
    redirected (OAuth 2.1 §4.1.2.1). After them, the page sends the browser to the redirect URI
    with `error`, `state` and `iss`.
  - **Success** sends the browser to the redirect URI with `code`, `state` and `iss=<origin>`
    (RFC 9207).

## 5. Consent

- **An owner consents on Baton's dashboard, in the browser that asked.**
  - **The session.** The consent page reads nothing until it has an owner's dashboard session:
    its first call, `POST /v1/ui/oauth/requests`, carries the session cookie or is refused
    `unauthenticated`, and the page then shows "sign in to Baton to continue" with a link to
    `/login?as=owner` in a new tab and a Check again button. Sign-in is R-BTN-155's, unchanged:
    the owner types that page's owner sign-in code into `baton owner open`, which binds it with
    the owner key through `POST /v1/owner/login-links` and works from any machine with the key,
    the phone's code typed at a desk included. The session that results is an owner's
    (`owner-session`, `BATON_SPEC` R-BTN-129): it holds the repositories its key owns, and dies
    with that key's ownership. Without a session the page
    shows nothing about the client, fetches no document and writes no row.
  - **The request.** With an owner's session, `POST /v1/ui/oauth/requests {query}` runs §4's
    checks, writes an `oauth_requests` row bound to that session and living 10 minutes, and
    answers `{request, client, redirect_uri, requested, repositories, expires_at}`: `request` is
    the handle `bor_<id>_<secret>`, kept only in the page's memory; `repositories` are the
    session's repositories its key still owns (R-BTN-155), on which `api_keys` is not `false`. A check failing after §4's
    step 2 answers `{error, redirect}`, which the page follows.
  - **What the page shows** (all through `textContent`, §6): the client as §3 names it, its
    self-declared name, the full redirect URI, and for a loopback redirect "the code goes to
    whichever program on this computer listens on port <n>"; a repository picker (preselected
    when the session owns one); the actions, with `read` ticked, `ticket.hold` unticked, and
    `leg.stop` unticked under its own line "destructive: stops running legs", each offered only
    if requested; the lifetime (default 30 days, at most 90); and "Approve only a connection you
    started yourself, in this browser, just now: approving lets that client act on this
    repository as you."
  - **Approve.** `POST /v1/ui/oauth/approve {request, repository, actions, ttl?, name?}`
    (`owner.mcp-key.approve`):
    - refused unless the session is the one the request is bound to, owns `repository`, and the
      actions are within the request's scope, R-BTN-130's allowlist and the owner's own actions;
    - records the approval on the request row and issues the authorization code (§8); it mints
      no grant: the grant is created at the code's first redemption (§7), so an approval that is
      never redeemed leaves nothing behind;
    - answers `{redirect, repository, actions}`; the page shows "approved for <repository>:
      <actions>" and navigates to `redirect`.
    - An approval naming `leg.stop` is R-BTN-155's confirmed action: it answers `202
      {confirm_code}`, the page shows the code, the owner confirms it with `baton owner confirm`
      and the key that minted the session (`POST /v1/owner/confirm`), and the page polls `POST /v1/ui/oauth/status {request}` every 2 seconds for the redirect.
      `read` and `ticket.hold` need no confirmation code (Decisions).
  - **Deny.** `POST /v1/ui/oauth/approve {request, deny: true}` (`owner.mcp-key.deny`) ends the
    request and answers `{redirect}` carrying `access_denied`. Closing the page is a silent
    denial: the request expires.
  - **Status.** `POST /v1/ui/oauth/status {request}` answers `{pending: true}`, `{redirect,
    repository, actions}` (again on every call until the code is redeemed or expires, so a lost
    answer is recoverable), `{expired: true}` or `{gone: true}` (denied, redeemed, or unknown).
  - **Who may approve.** `owner.oauth.request`, `owner.oauth.status`, `owner.mcp-key.approve` and
    `owner.mcp-key.deny` admit only an owner's dashboard session (principal `owner-session`,
    R-BTN-129, R-BTN-155), on its own repositories: no key, so no CLI or agent holding an owner key approves without a browser;
    and no administrator's session, which has no owner key for a grant to die with. Every grant
    still has a minting owner key: the one that minted the approving session.
  - **What consent cannot tell.** An owner who approves a link someone else sent them connects
    that someone's client; Baton cannot see whose Claude account began a request. The page's
    sentence above, `client_addr` on the grant (§7) and the owners' listing are the defence, as
    with any OAuth authorization server. A non-owner teammate cannot be delegated to through
    OAuth: an owner mints them a `bmcp_` key for a client that sends a bearer.

## 6. The consent page and same-site

- **The consent page keeps R-BTN-16's rules whole.**
  - **`SameSite=Strict` stays.** A link from claude.ai to `/oauth/authorize` is a cross-site
    top-level navigation, so the browser sends no Strict session cookie with it. The page is
    therefore a static asset that reads no cookie and is the same for everyone. Its own calls
    are `fetch`es from a document whose top-level site is Baton's, so they are same-site and
    `Sec-Fetch-Site: same-origin`, and carry the cookie. No cookie is added or relaxed: a
    cross-site page can cause the navigation but cannot read the page, drive its calls, or send
    the cookie on a request of its own.
  - **Same-origin writes.** The `/v1/ui/oauth/*` routes are dashboard session routes: each
    requires `Content-Type: application/json`, an `Origin` equal to the origin and
    `Sec-Fetch-Site: same-origin` when sent (R-BTN-16), else `forbidden`. A cross-origin form
    cannot send JSON, a cross-origin `fetch` of JSON is preflighted and gets no CORS answer, and
    the Strict cookie is not sent cross-site; besides, `approve` and `status` need the request
    handle, which only the page that opened the request holds. Requests from another tab or
    session are refused `not-found`.
  - **No framing, no opener.** The page and every response carry `frame-ancestors 'none'` and
    `X-Frame-Options: DENY`; the page adds `Cross-Origin-Opener-Policy: same-origin`, so the
    window that opened it keeps no handle on it. Approve stays disabled until the page has been
    visible and focused for one second and a repository is chosen, against click-timing tricks
    in a window the attacker opened.
  - **Rendering.** Every server-supplied string reaches the screen through `textContent`
    (`BATON_SPEC` §12.3); hosts as A-labels (§3).
  - **The machine endpoints** (`token`, `register`, `revoke`) are called by servers and native
    clients: they send no CORS headers, and refuse a request whose `Origin` is present and not
    the origin (`invalid_request`).
  - **Nothing leaks from the page.** `Referrer-Policy: no-referrer` keeps the query from leaving;
    the request handle never leaves page memory; the authorization code reaches only a
    registered redirect URI in this browser and is useless without the PKCE verifier. A
    same-site origin running untrusted code is a redirect target only if an administrator lists
    one of its URIs.

## 7. What a grant is

- **A grant is an MCP key, and nothing more.**
  - The first successful redemption of an approved code writes one `mcp_keys` row with an
    immutable `id`, no `bmcp_` bearer (`key_hash` NULL), and its `client_id`, `client_addr`, the
    approving session and the approval time. Everything R-BTN-130 and R-BTN-154 say of an MCP
    key holds for it:
    - one repository, the one the owner chose;
    - action ids resolved at approval from the actions the owner ticked, by default `read` only;
      never wider than the requested scope, R-BTN-130's allowlist or the owner's own actions;
      `ticket.hold` and `leg.stop` only when the owner ticked them, `leg.stop` confirmed;
    - authorized as its minting owner key (the approving session's) on that repository, narrowed
      to its ids, only on `POST /v1/mcp`; a hold only adds (`hold_reason: mcp:<name>`);
    - at most 90 days (default 30), ended by 7 days without an MCP call, its minter's removal
      or revocation, or `owner.mcp-key.revoke`; refused while the repository has
      `api_keys: false` (§9).
  - **Scopes are R-BTN-130's `--actions` spelled with spaces**: `read` (the allowlisted reads
    existing at approval), `ticket.hold`, `leg.stop`, or any allowlisted read id. The token
    response's `scope` lists the approved tokens.
  - **No step-up.** A tool the grant lacks is not listed, and calling it is `forbidden`
    (R-BTN-130), never a `403 insufficient_scope`: Baton offers no existence oracle. A client
    needing more re-authorizes into a new grant.
  - **Names.** The name defaults to the client's host (`claude.ai`; for a `bdc_` client the
    redirect URI's host, `localhost` for loopback), then `claude.ai-2`, …, at most 40
    characters, unique among the repository's live grants and approved, unredeemed requests.
    Tokens and requests refer to the grant by `id`, never by name, so a later grant of the same
    name never inherits an older grant's tokens. Owners list grants with their keys: client
    host, minter, `client_addr` and approval time.

## 8. Tokens

- **Codes and tokens: short access, rotating refresh.**
  - **Authorization code.** 256 random bits, base64url; issued at approval; lives 60 seconds;
    bound to the request's `client_id`, `redirect_uri`, `code_challenge` and resource. Only a
    successful redemption consumes it. A wrong verifier counts on the code, and the third kills
    the code, never a grant. A consumed code presented again with the correct verifier is
    `invalid_grant` and revokes the grant it created (OAuth 2.1 §4.1.3); with a wrong one it is
    only `invalid_grant`, so a leaked code cannot be used to kill a grant.
  - **The token endpoint** (`POST /v1/oauth/token`, `application/x-www-form-urlencoded`; answers
    carry `Cache-Control: no-store`):
    - `grant_type=authorization_code` with `code`, `redirect_uri` (equal to the request's),
      `client_id` (equal), `code_verifier` (43–128 unreserved characters, whose `S256` is the
      challenge) and optional `resource` (§4's check). Its first success creates the grant (§7)
      and its first tokens in one transaction, rechecking §10's grant cap and `api_keys`.
    - `grant_type=refresh_token` with `refresh_token`, `client_id` (equal to the grant's) and
      optional `scope`: the answer carries the grant's scope whatever is asked; only a malformed
      scope string is `invalid_scope`.
    - answer `{access_token, token_type: "Bearer", expires_in, refresh_token, scope}`.
  - **Access token** `bmo_<id>_<secret>` (64 bits of id, 256 of secret): opaque, looked up and
    its grant checked on every call, so revocation is immediate. It lives one hour, never past
    its grant's expiry, and is accepted only on `POST /v1/mcp` at its origin; elsewhere it is
    `unauthenticated` (R-BTN-130).
  - **Refresh token** `bmr_<id>_<secret>`, one family per grant with a generation counter,
    rotated on every use (OAuth 2.1 §4.3.1). Presenting a live token of the current generation
    `g` mints a token of `g+1` and marks the presented one used. It lives as long as its grant.
    An access token already issued lives out its hour unless the grant ends.
  - **Siblings and reuse.** A used generation-`g` token presented again within 60 seconds of its
    first use, while no `g+1` token has been used, is a lost response or a race (Claude waits
    30 s on a refresh): it mints another `g+1` sibling, at most three per generation. Siblings
    stay valid until one of them is used, which kills the rest. Any other presentation of a
    used or killed token — after the 60 seconds, after a `g+1` token was used, a killed
    sibling, a fourth sibling — is reuse: it revokes the grant and every token of it, records
    the act, and raises `baton.oauth-replay` (§9). So a thief replaying a stolen token inside
    the window is caught when either party next uses the other branch.
  - A refresh is not an MCP call: it does not reset R-BTN-130's 7-day idle clock.
  - **Tenant binding** (R-BTN-137): codes, request handles and tokens are rows of one tenant,
    stored as SHA-256 hashes and compared in constant time, unknown to any other; a token's
    grant names one repository of that tenant; the issuer and resource are the origin's, and
    `iss` in every authorization response lets a client detect a mix-up.

## 9. Revocation

- **A grant ends as an MCP key ends, and takes every token with it.**
  - A grant ends by `owner.mcp-key.revoke` by name, the minter's removal or revocation, expiry,
    7 idle days, code or refresh reuse (§8), RFC 7009 revocation, or a bearer crossing `http`
    (R-BTN-158, which adds `bmo_` and `bmr_` to its bearers). Every token resolves its grant by
    `id` and checks it on each use; an act that ends a grant also marks every token of it
    `revoked_at` in the same transaction.
  - **`api_keys: false`.** While it stands, access tokens are refused (`401` with the
    challenge) and refreshes and code exchanges are `invalid_grant`, so a client discards its
    tokens and the owner re-consents once the setting returns; the grant row is not ended, and
    idles out. A `bmcp_` key, unlike a grant, works again when the setting returns (R-BTN-130).
  - `POST /v1/oauth/revoke` (RFC 7009) takes `token` and `client_id`; an access or refresh token
    of that client revokes its whole grant. It always answers `200`.
  - **Records.** Approval, denial, a grant's creation, every end and every reuse write a
    repository `events` row of kind `oauth` (`detail.act`: `approved`, `denied`, `granted`,
    `revoked`, `replay`, `code-failed`), actor the approving owner or `mcp:<name>`.
  - **`baton.oauth-replay`** (notify) sits on the repository with `detail` `{grant_id, client_id,
    kind: "code" | "refresh", client_addr}`; its cause ends when the revoked grant's row is
    deleted, or an owner resolves it.
  - **Retention.** The alarm deletes an expired or settled request at `expires_at`, an expired
    access token at `expires_at`, a used or killed refresh token 7 days after its use (later, it
    is merely unknown: `invalid_grant`, no alarm), and an ended grant's row with all its tokens 90
    days after it ends, the owners' listing keeping `revoked_at` until then.

## 10. Bounds and abuse

- **Bounds.** Per tenant, as everything is (R-BTN-135):
  - **Per IP** (the per-IP rule, keyed `<host>|<ip>`, an IPv6 address by its `/64`): register
    20 an hour; token 120 a minute; revoke 60 a minute; the static page as any static asset.
    Past one, `429` with `Retry-After` and body `{error: "temporarily_unavailable",
    error_description: "rate limited"}`; the page shows "too many requests, try again in <n>
    s". Hosted Claude calls from one shared egress range (`160.79.104.0/21`), so the token limit
    is sized for a team's clients behind one address.
  - **Session routes** count as the session's authenticated calls (600 a minute). At most five
    open requests per session, each living 10 minutes; a sixth drops that session's oldest.
    No tenant-wide cap applies: only owners' sessions open requests.
  - **Failed verifications.** `bmo_` and `bmr_` join R-BTN-135's failure buckets by their
    `<id>`, and the active credential set its filter snapshots includes live refresh tokens. The
    token endpoint counts no failure in the (origin, client IP) bucket, because hosted Claude's
    exchanges share one egress: it relies on the per-IP limit, the per-code count (§8) and
    256-bit secrets.
  - **Registered clients.** At most 500 in the tenant. One with no grant within 24 hours is
    deleted; at the cap a registration drops the oldest client with neither a grant nor an open
    request, else is `429`.
  - **Documents.** At most 30 uncached document fetches a minute per tenant, and one a minute
    per URL per tenant after a failure; past either, the last valid copy serves (§3). An owner's
    session can make the Worker `GET` a public `https` URL; that blind fetch is accepted.
  - **Grants.** At most 50 live OAuth grants per repository, approved unredeemed requests
    counted; the 51st approval is `quota`.
  - **Writes.** A request, an approval, an exchange and a refresh each write a few rows, counted
    in R-BTN-149's budgets as the grant's (as a credential) and the repository's; neither
    refuses them, as owner writes are not refused.

## 11. Refusals

The OAuth endpoints answer as OAuth clients parse — RFC 6749 §5.2's `{error, error_description?}`,
`400` unless noted — not Baton's `{ok: false, code}`; the `/v1/ui/oauth/*` routes answer Baton's
codes, and the page shows them.

| Where | Case | Answer |
|---|---|---|
| authorization, before a session | no owner's session | `unauthenticated`; the page asks for sign-in, and nothing else happens |
| authorization, shown on the page | unknown or invalid `client_id`; a document that fails §3; a `redirect_uri` absent, unregistered or not allowed; a repeated `client_id` or `redirect_uri` | `invalid_client` or `invalid_request`, never redirected |
| authorization, redirected | `response_type` not `code` | `unsupported_response_type` |
| | no `code_challenge`, method `plain`, a challenge not 43 characters, another repeated or malformed parameter | `invalid_request` |
| | a scope token outside §7's set | `invalid_scope` |
| | a foreign `resource` | `invalid_target` (RFC 8707) |
| | the owner denies, or 10 minutes pass | `access_denied` |
| any OAuth route | past a §10 limit | `429` with `Retry-After`, `temporarily_unavailable`; the page shows it |
| token | an unknown, expired, killed or consumed code; a verifier, `redirect_uri` or `client_id` that does not match; a dead or suspended grant; a reused refresh token; a 51st grant at exchange | `invalid_grant` |
| | a client secret or an `Authorization` header | `invalid_client` (`401`) |
| | a grant type other than the two | `unsupported_grant_type` |
| | a malformed `scope`; a foreign `resource` | `invalid_scope`; `invalid_target` |
| register | a bad redirect URI; any other bad metadata, a confidential method | `invalid_redirect_uri`; `invalid_client_metadata` |
| `/v1/ui/oauth/*` | no session; an administrator's session, a foreign `Origin` or `Sec-Fetch-Site`, or a body that is not JSON | `unauthenticated`; `forbidden` |
| | an unknown, expired, settled or other session's request; a repository the session does not own | `not-found` |
| | `api_keys: false` on the repository | `forbidden` |
| | actions beyond the scope, the allowlist or the owner's actions; `ttl` over 90 | `invalid-params` |
| | a name in use; a 51st grant; `leg.stop` without its code | `conflict`; `quota`; `202 {confirm_code}` |
| `POST /v1/mcp` | no, unknown, expired, revoked or suspended bearer | `401` with §2's challenge |
| | a foreign `Origin`; a tool the grant lacks | `403`; tool error `forbidden` (R-BTN-130) |

## 12. Data model rows

For `BATON_SPEC` §13.2 (and `instance_settings` in §13.1). Hashes only (`BATON_SPEC` §12.1's
bearer rule), which adds `bmo_`, `bmr_` and `bor_`.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `mcp_keys` (changed) | `id` (random, never reused); unique `(repository_id, name)` among live rows | `key_hash` NULL for an OAuth grant; adds `client_id` (a document URL or `bdc_` id; NULL for a minted key), `client_addr`, `approved_session` (`bds_<id>`), `approved_at`, `ended_at` | R-BTN-130, R-BTN-172; an ended row kept 90 days |
| `oauth_clients` | `id` (`bdc_<id>`, public) | `redirect_uris` JSON (≤ 10), `client_name`, `application_type`, `created_at`, `created_addr`, `first_grant_at` | Registered clients; deleted unused after 24 h (R-BTN-172) |
| `oauth_requests` | `id` (of `bor_<id>_<secret>`) | `secret_hash`, `session_id`, `client_id`, `client_name`, `redirect_uri`, `state`, `code_challenge`, `requested` JSON, `client_addr`, `created_at`, `expires_at` (+10 min); at approval `repository_id`, `actions` JSON, `ttl_days`, `name`, `approved_at`, `confirm_pending`, `auth_code_hash`, `auth_code_expires_at` (+60 s), `auth_code_failures`; `denied_at`; at redemption `redeemed_at`, `mcp_key_id` | A pending or settled authorization (R-BTN-172) |
| `oauth_tokens` | `id` (of `bmo_` or `bmr_`) | `kind` (`access`\|`refresh`), `secret_hash`, `repository_id`, `mcp_key_id`, `client_id`, `generation` (refresh), `created_at`, `expires_at`, `used_at`, `killed_at`, `revoked_at` | R-BTN-172; retained as §9 says |
| `instance_settings` (changed) | one row | adds `oauth_redirect_uris` JSON (default Claude's two callbacks) | R-BTN-172 |

**Alarm instants** (for `BATON_SPEC` §2.1): a request's `expires_at`, a code's
`auth_code_expires_at`, a token's `expires_at`, a refresh token's `used_at` + 7 days, an unused
client's `created_at` + 24 hours, an ended grant's `ended_at` + 90 days. **`events.kind`** (for
§13.8) adds `oauth`.

## 13. Routes

For `BATON_SPEC` §14. The consent page is a static dashboard asset, not an action (R-BTN-129).
Every other route is a registry entry: the metadata, token, register and revoke entries list
`public`; `owner.oauth.request`, `owner.oauth.status`, `owner.mcp-key.approve` and
`owner.mcp-key.deny` list only `owner-session` (an owner's dashboard session, R-BTN-129), scope
`repository` (§5), and none is ever `mcp: true`.

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `GET /.well-known/oauth-protected-resource/v1/mcp` | none | — | the protected resource metadata | R-BTN-172 |
| `GET /.well-known/oauth-authorization-server` | none | — | the authorization server metadata | R-BTN-172 |
| `GET /oauth/authorize` | none (static asset) | the authorization request | the consent page | R-BTN-172 |
| `POST /v1/ui/oauth/requests` | an owner's session | `{query}` (the raw query string) | `{request, client, redirect_uri, requested, repositories, expires_at}`; or `{error, redirect?}` | R-BTN-172 |
| `POST /v1/ui/oauth/approve` | an owner's session | `{request, repository, actions, ttl?, name?}`; `{request, deny: true}` | `{redirect, repository, actions}`; `202 {confirm_code}` with `leg.stop`; `{redirect}` on deny | R-BTN-172, R-BTN-155 |
| `POST /v1/ui/oauth/status` | an owner's session | `{request}` | `{pending: true}`, `{redirect, repository, actions}`, `{expired: true}` or `{gone: true}` | R-BTN-172 |
| `POST /v1/oauth/token` | a public client: PKCE, or its refresh token | form: §8's | the token response | R-BTN-172 |
| `POST /v1/oauth/register` | none | RFC 7591 JSON | `201` with `client_id` | R-BTN-172 |
| `POST /v1/oauth/revoke` | a public client | form: `token`, `client_id` | `200` | R-BTN-172 |
| `PUT /v1/admin/settings` (changed) | admin | adds `oauth_redirect_uris` | `{ok: true}` | R-BTN-172 |
| `POST /v1/mcp` (changed) | an MCP key, or an OAuth access token, as a bearer | as R-BTN-130 | `401` carries R-BTN-172's challenge | R-BTN-130, R-BTN-172 |

**Admission and Access** (`BATON_SPEC` §2.3, R-BTN-16): `/oauth/authorize` is a static page
needing no session, as `/login` is; `/.well-known/oauth-*` and `/v1/oauth/*` are unauthenticated
routes under the per-IP rule; `/v1/ui/oauth/*` needs an owner's dashboard session, as an
`owner-session` route of `/v1/ui/*`. Codes, verifiers and tokens are checked inside the object. Where Cloudflare Access fronts
the dashboard it is bypassed on `/v1/mcp`, `/v1/oauth/*` and `/.well-known/*`, which hosted
Claude calls without an Access cookie; `/oauth/authorize` and `/v1/ui/oauth/*` stay behind it,
since the owner's browser passes it.

## 14. Scenario and gate

Rows for `BATON_SPEC` §15, under its §11 heading. S-BTN-137 is one scenario in four parts, one
test file each (`S-BTN-137.<part>.test.ts`).

| Scenario | Script | Expected |
|---|---|---|
| S-BTN-137 MCP clients through OAuth: (1) connecting Claude | a tokenless `POST /v1/mcp`; discovery; Claude Code's document with `http://localhost:3118/callback`, and hosted Claude's callback; the page opened by a cross-site navigation in a browser with an owner's session; the owner approves `read ticket.hold` from a request for `read ticket.hold leg.stop`; the exchange; `tools/list`; a hold; a refresh; the redirect fetched again by `status` after a lost answer | `401` with the three-scope challenge; the documents as §2, the root resource document `404`; the page's calls carry the cookie and `Sec-Fetch-Site: same-origin`; `read` alone ticked by default; redirect with `code`, `state`, `iss`; no `mcp_keys` row until the exchange; tokens; only the approved tools; `held` with `mcp:<name>`; a rotated refresh token; the same redirect |
| (2) refused authorizations | no session; an administrator's session; another session's request handle; approve with a foreign `Origin`, a cross-site `Sec-Fetch-Site`, a form body; a framed page; `plain`, absent and 44-character challenges; an unregistered, non-allowlisted, fragment and non-ASCII redirect; a repeated `client_id`; a foreign `resource`; an unknown scope; a wrong verifier three times, then the right one; a code redeemed and presented again with a wrong and then the right verifier; a code after 60 s; a denial; an expired request; `api_keys: false`; widened actions; `leg.stop` before and after its confirmation code; a 51st grant | each as §11; no session, no request row and no document fetch; no redirect before the client and redirect validate; the code dead after three failures and no grant; the grant revoked only by the right verifier; `202 {confirm_code}`, then the redirect by `status` |
| (3) a grant's life | a refresh replayed within 60 s, then the sibling used, then the killed one presented; two concurrent refreshes, one result kept; a replay after 60 s; an access token past an hour; 8 idle days; the minter revoked; `api_keys: false`; `owner.mcp-key.revoke`; RFC 7009 revoke; a new grant taking an ended grant's name; a token on a REST route, at another tenant, over non-loopback `http` | a sibling; the other killed; the grant revoked, `baton.oauth-replay`, an `oauth` `replay` event; the connection kept; revoked; `401`; dead; dead; `401`, then `invalid_grant`; dead at the next call; dead; the old tokens stay dead; `unauthenticated`; `401`; revoked and `baton.bearer-over-http` |
| (4) registration and abuse | registration with `client_secret_basic`, 11 redirect URIs, a 21st in an hour from one IPv6 `/64`, at 500 clients with one holding an open request; an unused client after 24 h; documents over 5 KB, redirected, on a private address, on the deployment's own host, with a mismatched `client_id`, with a secret method, with one non-conforming redirect URI, with a `client_name` carrying U+202E; a document re-fetch failing and over budget; a sixth open request in one session | `invalid_client_metadata`; `invalid_redirect_uri`; `429`; the oldest client without grant or request dropped; deleted; each refused on the page, nothing cached, no linked URL fetched; that URI ignored; the name dropped; the stale copy served; the session's oldest request dropped |

| Gate | Invariant | Proved by |
|---|---|---|
| G-BTN-157 | (1) An OAuth token grants exactly what an MCP key of the approving owner key with the approved ids grants — one repository, ids within the request's scope, R-BTN-130's allowlist and the owner's actions, holds only added — and is accepted only on `POST /v1/mcp` at its origin. (2) An authorization code issues only through `POST /v1/ui/oauth/approve` from the owner's dashboard session that opened the request, carrying that request's handle, same-origin; it goes only to a redirect URI the client registered that passes §4, with an `S256` challenge; `leg.stop` needs R-BTN-155's confirmation code; no key, administrator session or cross-origin request approves, and the page cannot be framed. (3) Codes, request handles and tokens are stored only as hashes; a code is consumed only by a successful redemption within 60 s; a refresh family has one live generation, bar the 60-second siblings, and any other reuse ends the grant; tokens name their grant by its immutable `id`, and ending it ends every token. (4) Baton fetches only an `https` client document at a globally reachable address outside the deployment, without redirects, at most 5 KB, and nothing it links; it never issues or accepts a client secret; registrations stay within §10's caps | S-BTN-137 |

## Decisions

- Chose standard OAuth consent on Baton's dashboard, the owner signed in (R-BTN-155) in the
  browser that started the request, over the first draft's design, in which the page showed an
  eight-character code, an owner approved it with `baton owner mcp-key approve` and the owner
  key, and the page collected the redirect by polling `POST /v1/oauth/requests`. That design
  handed the authorization code to whoever polled, so any HTTP client could open a request,
  send an owner its code, and redeem the approval with its own verifier: device-code phishing,
  against which redirect-URI checks and PKCE protected nothing. Consent in the browser that
  asked sends the code only to the client's registered redirect in that browser. It costs an
  owner's dashboard session at consent and the delegation of a grant to a non-owner (owner
  decision, 2026-10-20; R-BTN-172 §5).
- Chose a static consent page whose same-origin `fetch`es carry the `SameSite=Strict` session
  cookie over relaxing it to `Lax` or adding a consent cookie: the cross-site navigation carries
  no authority, and R-BTN-16's two cookies stay the only ones (2026-10-20; R-BTN-172 §6).
- Chose approval of `read` and `ticket.hold` without R-BTN-155's confirmation code, and
  `leg.stop` only with it: a session already reads and holds without confirmation, an owner on a
  phone can then connect Claude, and the grant's longer life is bounded (90 days, 7 idle days),
  listed with `client_addr` and revocable. The cost is that a stolen session can mint a read and
  hold grant that outlives it, the exposure R-BTN-155 already accepts for an API-key owner
  (2026-10-20; R-BTN-172 §5).
- Chose the expected re-consent cadence: a connection used weekly lives to its lifetime (30 days
  by default, 90 at most), one idle 7 days or whose minting key is rotated ends, and re-consent
  is one browser approval, from a phone where its browser is signed in (2026-10-20; R-BTN-172 §7).
- Chose a grant that is an `mcp_keys` row created at the code's first redemption, its tokens
  naming it by an immutable `id`, over OAuth grants with an authority of their own or a grant
  minted at approval: one authorization path, one listing, one revocation, and no orphan grants
  from unredeemed approvals (2026-10-20; R-BTN-172 §7).
- Chose a challenge naming all three scopes and consent defaulting to `read`, over a `read`
  challenge, which no Claude client widens, and over granting what the client asks: the owner,
  not the client, adds `ticket.hold` and `leg.stop`; no step-up challenge, so no `403` reveals a
  tool (2026-10-20; R-BTN-172 §2, §7).
- Chose opaque access tokens looked up on each call over JWTs: Baton is its own resource server,
  and revocation is immediate (2026-10-20; R-BTN-172 §8).
- Chose refresh families with 60-second siblings over strict single use, which a timed-out
  refresh would turn into a lost grant, and over a grace window that silently kills a
  successor, which hides a theft inside the window (2026-10-20; R-BTN-172 §8).
- Chose that only a successful redemption consumes a code, and only the correct verifier
  revokes on reuse, so a leaked code is no kill switch (2026-10-20; R-BTN-172 §8).
- Chose Client ID Metadata Documents first and dynamic registration kept, bounded, for older
  clients; public clients only (2026-10-20; R-BTN-172 §3).
- Chose exact redirect URIs an administrator lists, loopback always allowed, over allowed hosts,
  which admit any open redirect or observable page on them (2026-10-20; R-BTN-172 §4).
- Chose no CORS: browser-page MCP clients cannot connect; Claude's clients are servers and
  native apps (2026-10-20; R-BTN-172 §2).
- Chose that `api_keys: false` makes OAuth clients re-consent rather than resume, since a client
  discards a refresh token answered `invalid_grant` (2026-10-20; R-BTN-172 §9).

## Open questions

- **The default redirect URIs.** `oauth_redirect_uris` defaults to Claude's two callbacks so
  connecting Claude needs no administrator step. The alternative is an empty default, loopback
  only, with the administrator adding URIs.
- **Consent inside Claude's browsers.** Unverified: how long hosted Claude's popup, the mobile
  apps' authentication session and Claude Code's loopback listener wait while an owner signs in,
  and whether the mobile session shares the system browser's cookies (an ephemeral one would
  need a sign-in every time). B-73's manual check records what it finds.
- **Hosted Claude's client document.** Its URL and contents are unverified; a URI it lists outside
  `oauth_redirect_uris` is ignored, not fatal.
- **A changed client document.** Baton checks a document at authorization only. Re-checking it
  at refresh, and ending grants whose redirect URIs it no longer lists, is deferred until a client
  needs it.
- **Non-owner teammates.** Delegating a grant to a teammate who is not an owner (an invitation an
  owner prepares, redeemed in the teammate's browser) is deferred; they use an owner-minted
  `bmcp_` key in a client that sends a bearer.
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
  redirects), RFC 9700 (OAuth security BCP), RFC 6890 and RFC 8190 (special-purpose addresses).
- OAuth Client ID Metadata Document, draft-ietf-oauth-client-id-metadata-document-02 (6 July
  2026): <https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-02>.
  The MCP revision cites -00; nothing this spec relies on differs.
- Anthropic, "Authentication for connectors": <https://claude.com/docs/connectors/building/authentication>
  (callback `https://claude.ai/api/mcp/auth_callback`, CIMD only with `none` advertised,
  port-agnostic loopback, refresh rotation and `invalid_grant`, 10 s and 30 s timeouts, egress
  `160.79.104.0/21`).
- Anthropic, "Lazy authentication for MCP servers": <https://claude.com/docs/connectors/building/lazy-authentication>
  (the `401` shape and its `scope`, `insufficient_scope` step-up, discovery caching).
- Claude Code's Client ID Metadata Document: <https://claude.ai/oauth/claude-code-client-metadata>
  (fetched 2026-10-20: `http://localhost/callback` and `http://127.0.0.1/callback`, no
  `Cache-Control`).
- Anthropic support, "Building custom connectors via remote MCP servers" (the possible move of the
  callback to `claude.com`), article 11503834 at support.claude.com; the slug-less link returned
  `404` on 2026-10-20, so B-73 records the working URL.
