---
title: "Proposal — multi-tenant deployment and admission limits"
description: "A deployment that serves several tenants as a router in front of single-tenant Batons, and the Worker's rate limits and failure filter within a tenant."
---
# Proposal — multi-tenant deployment and admission limits

**Status:** proposal — not built; moves into BATON_SPEC §2 when built (tickets B-45, B-46)

BATON_SPEC [§2.2](../BATON_SPEC/02-deployments.md#sec-2-2) states what a tenant is and that
nothing crosses one. This page holds what a deployment serving several tenants would add, and the
rate limits of [§2.3](../BATON_SPEC/02-deployments.md#sec-2-3) that no code enforces yet. Rule ids
are labels here; each stays defined in §2.

## Many tenants is a router

R-BTN-135 (proposed):

- **Object names.** The tenant's object is `idFromName(<tenant id>)`; every other object it uses
  is `idFromName('<tenant id>/<kind>/<key>')`. A tenant id matches `^[a-z][a-z0-9-]{0,31}$`, is
  never reused, and retiring a tenant deletes its objects' storage. Each Cloudflare deployment's
  first tenant, and every local host, is `baton`.
- **Handshake.** The shell (shared code in `src/shell/`) strips any client-supplied
  `x-baton-tenant` header and sends the tenant id in it. The object records the id in
  `baton_settings.tenant_id` at its first request and refuses a request whose id differs or is
  absent with `forbidden`, logged for the operator as `tenant-mismatch`, not as a tenant event.
  The alarm does nothing until an id is recorded.
- **The router.** A deployment serving several tenants maps each host, one to one, to a tenant
  record (id, origin, secrets) the operator holds, and adds per-tenant caps: requests
  (`rate-limited` with `retry_after_s`), row writes and storage (`quota` until the day turns or
  space is freed). It changes no route, token format, signature base, CLI command, configuration
  file, wire field or rule. It serves `https` only, and tenant hosts sit under a registrable
  domain on the Public Suffix List that serves nothing else.
- **What the deployment holds across tenants**: only the per-IP rule, caches of public data keyed
  by the exact URL fetched (a CI key set by its key-set URL, never its issuer's name), and each
  tenant's credential snapshot for the failure buckets, keyed by origin.
- A rule that reads or writes another tenant's state, or depends on how many tenants a deployment
  serves, is refused in review; sharing across tenants is federation, which Baton does not do.

R-BTN-136 (proposed):

- A deployment serving several tenants keeps one set of host values per tenant in the operator's
  record, outside tenant storage, so each tenant has its own GitHub App.
- The secret sink gains `operator`, which authenticates the tenant's account at the operator,
  never with a Baton key.
- The operator provisions and retires tenants. Moving a tenant: the operator provisions the
  target; the tenant's administrator runs R-BTN-88's freeze, seal, export and import.

R-BTN-2 (proposed): a deployment serving several tenants runs on a paid plan and shows each
tenant its own usage counters only.

## Admission limits within a tenant

Not built (B-46): the Worker forwards every request that passes its route's first check.

- **A per-IP rule** (a Workers rate-limit binding keyed `<host>|<ip>`) applies only to
  unauthenticated requests, never to the two forge-notification routes, whose bodies R-BTN-73
  caps instead.
- **Authenticated calls** are limited to 600 a minute per credential, keyed by origin and
  credential, counting only requests the object verified.
- **Failed verifications** count in two buckets: (origin, credential id, client IP) and (origin,
  client IP). A credential id is an SSH keyid or the `<id>` of a `bak_` or `brt_` bearer, a
  session cookie `bds_<id>_<secret>` or a pending sign-in `bps_<id>_<secret>`; an MCP key
  (`bmcp_`), which has no id part, counts only in (origin, client IP); CI tokens, App deliveries
  and forge notifications count in none. Beyond 60 failures a minute in a bucket, the Worker
  checks that bucket's requests for the rest of the minute against a snapshot of the tenant's
  whole active credential set, fetched at most once a minute and again at most once every 5 s on
  a request that matches nothing; unmatched requests during a re-fetch are forwarded at most one
  a second per bucket. It refuses `unauthenticated` only the failing requests: a request that
  verifies is never refused by a bucket. The check is a filter; the object verifies every
  forwarded request in full (R-BTN-13).
- **Lease upkeep** — heartbeats of an existing session, `advance`, `end`, release
  acknowledgements; not a first heartbeat, which creates a session — is never refused by a
  per-tenant cap. It has its own buckets: 30 calls a minute per live claim, spent only by its
  holder; 30 a minute plus 10 per live session per credential for sessions holding no claim. An
  exhausted bucket answers `rate-limited` with `retry_after_s`. The sidecar coalesces
  ring-triggered heartbeats to one per 10 s per session, except a ring carrying a `release`.
- **Per-credential caps** (R-BTN-149, proposed):

  | Cap | Limit | Past it |
  |---|---|---|
  | live runner rows per credential | 64 | the 65th first heartbeat `quota` |
  | new sessions per credential per day | 200 | the 201st first heartbeat `quota` |
  | non-upkeep row writes per credential per repository per UTC day | 50,000 | `quota` for that credential until 00:00 UTC |
  | a credential's heartbeat declaration and report writes per UTC day | 50,000 | dropped, the lease kept, the heartbeat answered `declarations: 'quota'`, until 00:00 UTC |
  | a repository's non-upkeep row writes per day | 150,000 | raises `baton.write-budget` at 80% |

  Neither write budget refuses owner or administrator writes, or the repository's sync key or CI
  identity. A heartbeat writes `last_seen_at` only, unless its declared capabilities, tags,
  courses or settings hash changed or it carries reports; those further writes are what the
  declaration budget counts.
