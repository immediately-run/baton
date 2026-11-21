---
title: Deploy Baton to Cloudflare
description: Configure and verify a Baton Worker and SQLite Durable Object from a terminal.
---

This operator guide assumes Node 22.13 or newer, a Cloudflare account with Workers and
Durable Objects, and an active DNS zone. Start with a checked-out release. Use these values
consistently; `example.com` is a placeholder, not a deployment to reuse.

| Value | Example |
|---|---|
| Cloudflare zone | `example.com` |
| Worker hostname | `baton.example.com` |
| Public origin / OIDC audience | `https://baton.example.com` |
| Access team | `your-team.cloudflareaccess.com` |
| Access owners | `owner@example.com` and the other dashboard operators |
| Repository and id | `your-org/your-repo` and `project` |

## Prepare the Worker

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build:ui
npx --no-install wrangler login
npx --no-install wrangler whoami
```

Verify the selected account owns the zone. Make an operator-owned copy of `wrangler.toml`
(e.g. `wrangler.site.toml`, next to the original). Set `name`, the route `pattern` (e.g.
`baton.example.com/*`), `zone_name` and `vars.BATON_ORIGIN`. Keep the `BATON` binding, `Baton`
class, migration tags and text bundling rules. Replace the entire example `BATON_REPOSITORIES`
value with `[]` to register repositories after bootstrapping, or provide your own registrations
with the exact default branch, sync workflow path, and owner public keys. Do not copy a deployed
instance's seed, put private keys in TOML, or set `BATON_TEST_BINDINGS` or `TEST_*`.

Create a **proxied** DNS record for the hostname in the zone for the Worker route. If you use
Cloudflare Access, configure your team and restrict the dashboard to your operators. Keep the
machine API and webhook paths reachable with Baton's own authentication rather than an
interactive Access login. Access is additional dashboard protection; Baton's signed login and
repository roles still apply.

## Deploy and verify

From the operator's terminal, with the administrator's **public** key in `admin.pub`:

```sh
npx --no-install wrangler secret put BATON_ADMIN_KEYS --config wrangler.site.toml < admin.pub
npx --no-install wrangler deploy --config wrangler.site.toml
```

Use a distinct key for each role. Install an optional GitHub App only if you need delivery and
workflow dispatch; configure its id, private key and webhook secret as specified in
[BATON_SPEC §2.1](../spec/BATON_SPEC/02-deployments.md#sec-2-1) and
[§12.7](../spec/BATON_SPEC/12-security.md#sec-12-7). Do not pass secrets as CLI argument values.

Set `BATON_URL` to your origin in the operator's terminal. Use the pinned CLI release to run
`baton admin -i ADMIN_KEY repos`, then `baton admin -i ADMIN_KEY open` and follow the one-time
login link through Access if enabled. A machine API redirect to a login page usually means the
Access rule covers too much. A DNS failure or unexpected origin response points to the proxied
DNS record, Worker route, or wrong account.

Register the repository and its owners with `baton admin repo add` if it was not seeded.
Configure `baton repo sync` to post from that repository using its registered workflow's GitHub
Actions OIDC token (the audience must equal `BATON_ORIGIN`), or register an SSH sync key and use
`--sync-key FILE`. Check that the board's head matches the repository's default branch. Grant a
separate runner key with the required course capabilities. From a runner host, follow
[AGENTS.md](../AGENTS.md) with a designated trial ticket; watch the board and confirm the final
station after the merge and sync. A home binds to one Baton: use a disposable repository for a
local rehearsal rather than pointing an existing production home at a second service.

## Upgrade and recover

Repeat the checks before deploying from a new revision and verify the dashboard, sync and
runner again. Prefer fixing forward: a Worker rollback does not reverse Durable Object schema
migrations. Keep the Worker name and Durable Object binding stable. Do not delete a Worker or
its storage as a rollback step. See [README](../README.md) for exporting owner state before a
move; git rebuilds the board, not the live claim and authorization ledger.
