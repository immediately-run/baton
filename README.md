# Baton

The immediately.run factory's live state — work-item leases, workers, providers and the
dashboard at `https://baton.immediately.run` — on a Cloudflare Worker and one SQLite
Durable Object.

The design is `BATON_SPEC`, [`spec/BATON_SPEC.md`](spec/BATON_SPEC.md) (moved here from the
`immediately-run/docs` repository in R3-1252); the work is the tickets in [`tickets/`](tickets/). Where
an item says `infra/baton/<path>`, it means `<path>` in this repository (BATON_SPEC §3).

How Baton differs from a durable-execution engine such as Temporal, and where each fits:
[`docs/compared-to-temporal.mdx`](docs/compared-to-temporal.mdx).

## The CLI on npm

`@immediately-run/baton` is the `baton` command, published from this repository:

```sh
npx --yes @immediately-run/baton@0.1.1 run   # a runner (§6.13), with IR_BATON_KEY_FILE set
```

From the package, `baton run`, `baton repo init`, `baton decision list` and the
`baton admin|owner|worker …` API client work. Init names the commit the package was built from
(`dist/build.json`) as its courses' source and its workflow's pin, and copies the leg stubs and
instructions `build:cli` prebuilt into `dist/defaults/`, so it needs no checkout and no esbuild.
`--eject` copies prebuilt defaults the same way. In a
checkout, run the CLI as `node cli/baton.mjs`.

## Layout

| Path | What |
|---|---|
| `src/core/` | Everything Baton decides, on either host (R-BTN-55): no platform import, checked by `test/unit/boundary-host.test.ts` |
| `src/core/ports.ts` | The platform services core takes: `Store`, `Scheduler`, `Clock`, `AdminKeys`, `HookRunner`, `Dispatch`, `Gate`, and the instance's `Config` |
| `src/core/front.ts` | What stands in front of the core: verifies the principal (OIDC for the sync, Access for the owner, a signed request's shape for a worker, the App's signature for a webhook), sets the R-BTN-16 headers, serves the dashboard, forwards the API |
| `src/core/baton.ts` | The core: migrations, board sync (§7.1), routing, the alarm, the dashboard state |
| `src/core/workerApi.ts` | The worker API (§11): heartbeat and registration, activities, messages, suspensions, mode and shadow reports, the Workers view |
| `src/core/claims.ts` | The lease (§6, R3-1212): claim and end, matching (§7.2 rules 1–9 via `isEligible`), the alarm's reaps, the fence before re-issue, confirmations, git winning over a stale claim, the Running / Timeline / Needs you data |
| `src/core/attempts.ts` | Pure: the retry policy (§6.10 R-BTN-23) — which ends count, backoff, holds, the review-capacity run, the resume record (R-BTN-24) |
| `src/core/admin.ts` | Administrators and owners (R-BTN-57/-58, R-BTN-66/-67): repositories, probes, grants, owners, owner bars, required bars, `retry`, `transcript_repos`, login links and dashboard sessions — the one set of validated functions the signed `/v1/admin/*` and `/v1/owner/*` routes and the `baton` CLI share |
| `src/core/registry.ts` | The registered repositories (R-BTN-47): a checked, insert-only registration, the `BATON_REPOSITORIES` seed, the one repository a sync token binds to (R-BTN-15), qualified ticket ids (`docs:R3-1205`) |
| `src/core/cutover.ts` | The one-way cutover (R-BTN-28): `POST /v1/ui/cutover`, the legacy import, adoption on the owner's confirmation |
| `src/core/blocks.ts` | Why a ticket cannot move (§2g R-BTN-75, -77, -78): the one writer of `ticket_blocks` and `blocked_since`, the fleet counts, the `unblocked` messages and dispatch, and the `blocks` and `blocked` queries |
| `src/core/notices.ts` | Requests for people (R-BTN-80, R-BTN-103): the one writer of `notices` and `worker_couriers` — a notice per personal courier and one pool copy per open decision, claimed and marked over `/v1/courier/*`, closed with the decision, reminded and deleted by the alarm |
| `src/core/history.ts` | Each ticket's history and Baton's disagreements with git (R-BTN-81, R-BTN-85): the one writer of `ticket_history`, `GET …/tickets/{ticket}/history`, the 90-day purge, and the `discrepancy` event and row logged before a snapshot's value is adopted |
| `src/core/resources.ts` | External resources, their account instances, a worker's `uses`, the readings of workers, probes and administrators, and each instance's state (R-BTN-76, R-BTN-101) |
| `src/core/detailSchema.ts` | Pure: R-BTN-76's JSON Schema subset, interpreted (no code generation), for a reading's `detail` |
| `src/core/validate.ts` | Pure: every worker- and owner-supplied field checked before any write (§10.4) |
| `src/core/webhook.ts` | GitHub App deliveries (R-BTN-73): `X-Hub-Signature-256` before anything is read, the one parser of R-BTN-73's fields, repeat and own-work drops, the repository map, one sync dispatch per repository per 30 seconds plus a trailing one |
| `src/core/observations.ts` | The per-repository observation counter (R-BTN-62): `POST /v1/sync/observation` hands out the next number (`sync-busy` while one is outstanding, void after 10 minutes); a board post's number is used once and must be above the last accepted reading's |
| `src/core/courses.ts` | The course registry each sync posts (R-BTN-48): its shape check, each course file judged by `validateCourse` (a failing one keeps the previous and is listed under Needs you, R-BTN-69), the `min_worker_version` rule 9 reads |
| `src/core/course.ts` | Pure: `validateCourse`, every way a course file breaks R-BTN-69's rules (stations reachable, an end from everywhere, cycles bounded, `start_leg`, inputs) |
| `src/core/stats.ts` | A course's own record (§2d, R3-1248): `GET /v1/repositories/{repository}/stats` — per station and leg wait and run times, ends by reason and detail, suspensions, advice overridden, `off-graph` and foreign writes; aggregates and ids only |
| `src/core/board.ts` | Pure: snapshot validation, the `tickets` row an item becomes, peaks, prices |
| `src/core/auth.ts` | JWT verification (R-BTN-15, R-BTN-16); the one verifier of signed requests, SSHSIG over RFC 9421 (R-BTN-13); worker tokens against `TOKEN_HASHES` during the transition |
| `src/cloudflare/` | The Cloudflare host: the Worker (`worker.ts`) and the `Baton` Durable Object (`baton.ts`), wiring `ctx.storage`, the alarm and `waitUntil` into the ports |
| `src/local/` | The local host: `node:sqlite` as the `Store` (`store.ts`), one queue for every request and alarm tick (`queue.ts`), a timer as the alarm (`host.ts`), `node:http` (`server.ts`), the command line (`main.ts`); the course test kit (`testCourse.ts`, R3-1248) |
| `src/runner/` | `baton run`'s worker loop (§6.13 R-BTN-72): the claim/leg loop (`runner.ts`), the pure result protocol (`protocol.ts`), the API client (`api.ts`), the state file and spool (`state.ts`), the home checkout's snapshot reads (`home.ts`), the leg child wrapper (`legProcess.mjs`) and the CLI entry (`main.ts`) |
| `src/migrations/` | Numbered schema migrations, applied before the object serves |
| `src/ui/` | The dashboard: one HTML page, one stylesheet, one ES module (`textContent` only) |
| `cli/` | `baton admin …` and `baton owner …` (`baton.mjs`); `baton decision list`, the CLI courier (`decisions.mjs`): one request per command, signed with the key file `-i` names by `ssh-keygen -Y sign` (`sign.mjs`); `baton test-course`, which needs no Baton |
| `src/shared/` | **Vendored** from docs `scripts/lib/` — never edit here (R-BTN-37); `batonSync.mjs` is the board sync's own decision code, which S-BTN-13 drives. Except two of Baton's own, which every part imports: `schema.mjs`, the one validator of leg outputs and readings (R-BTN-108: the subset, the linear-time pattern engine, the refinement check), and `std.mjs`, the `std:` library (R-BTN-110) |
| `test/unit/`, `test/integration/` | Vitest; `S-BTN-n` scenarios in `integration/`. Project `cloudflare` runs everything in the Workers runtime; project `local` runs every scenario again on the local host, plus the Node-only tests |
| `test/integration/trace.ts` | R3-1244: every scenario's run on the local host as a trace — one step per request or alarm tick, with the state projection the formal model has — written to `test/.traces/` |
| `test/model/replay.test.ts` | R3-1244: traces drawn from `model/replay.qnt` drive the core, compared with the model's state at every step |
| `scripts/check-traces.mjs`, `scripts/check-model-links.mjs` | R3-1244: replay each scenario's trace through `model/baton.qnt` (`npm run traces`); check that every model action and its implementation name each other, with current hashes (`npm run model:links`) |
| `test/hosts/` | The two hosts the harness drives, behind one interface (`#host`) |
| `test/lib/fixtureRepo.mjs` | The harness's stand-in for `docs/main`: a real bare git repo |
| `tickets/` | The tickets wiki: Baton's tickets (`tickets/*.mdx`, finished ones in `tickets/archive/`) and their board, opened on immediately.run by Grove (below) |
| `docs/` | The documentation wiki: how Baton works and how to run it (below) |

## Commands

- `npm test` (alias `npm run test:baton`) — the suite on both hosts, with a fake clock; `npx vitest --project local`
  (or `cloudflare`) runs one.
- `npm run test:no-quint` — the suite and `model:links` without quint: no model-drawn replay, no
  `traces`, no `model:quick`. It is all hosted CI and the deploy run (R-BTN-68): Quint runs only on
  the author's machine: in `npm test`, in `npm run model:pr` (about half an hour), whose report a PR
  that changes what the model checks read (the model, the core, the scenarios, …) carries in its
  body, and in the weekly `npm run model:full` on `main` (about three hours).
- `npm run start:local -- --db <path> --port <n>` — Baton as a local process (below).
- `node cli/baton.mjs test-course <repository root> <course> [--base REF|none] [--board FILE]` — the course test kit
  (§2d, R-BTN-64/-65): the working tree's `.baton/` against REF's (default `origin/HEAD`, else
  `origin/main`; none resolving is an error, `--base none` skips the removal rule), run on a local
  Baton — the core accepts the file, the live tickets FILE places keep their paths, a removal raised
  `min_worker_version`, each `legs/` script pairs with a leg and exports `run`, `handoff` and
  `close`, and a ticket runs the shortest route to a confirmed done. Exit 1 names each violation.
- `npm run typecheck` — the Worker, the local host and the Node scripts.
- `npm run model:links`, `npm run traces` — the code against the formal model (R3-1244; `model/README.md`).
  `npm test` runs both after the suite, and the model's own checks; `npm run model:pr` and
  `model:full` run `traces` too, on a fresh set.
- `npm run ticket -- claim|set|done|new …` — claim and move tickets with git as the lock
  (`scripts/ticket.mjs`; usage in `tickets/home.mdx`), until Baton claims them (R3-1266).
- `npm run check:wiki` — every page in `tickets/` and `docs/` compiles as MDX, uses only known
  components and links only to files that exist; every ticket matches `tickets/item.schema.json`.
- `npm run vendor` — re-copy `baton.mjs`, `vocabulary.mjs` and `sessionUsage.mjs` from a sibling `../docs`
  checkout (or `DOCS_DIR`) and rewrite `src/shared/manifest.json`. Do this in a PR here after
  docs changes any of them.
- `npm run fixtures` — regenerate `test/fixtures/boards.json` with the real docs
  `factory-state` code.

## The wikis

The repository holds two [Grove](https://github.com/immediately-run/grove) wikis, which
immediately.run opens: `package.json`'s `"immediately.run": {"content": ["tickets", "docs"]}`
lists them, and each folder's `immediately.run.json` opens it with the wiki viewer.

- **`tickets/`**, the tickets:
  <https://immediately.run/present/github/immediately-run/baton/main/bundle/tickets/home.mdx>.
  A ticket is `tickets/<id>.mdx`. New tickets are `B-n`; tickets that moved here from the
  immediately.run docs roadmap keep their `R3-NNNN` ids. A finished one moves to
  `tickets/archive/` with `status: done`. Its frontmatter follows `tickets/item.schema.json`;
  the body is prose for people and agents. The board's components (`tickets/components/`) are
  registered in `tickets/immediately.run.json`, as are the board view and the ticket record
  sets.
- **`docs/`**, the documentation:
  <https://immediately.run/present/github/immediately-run/baton/main/bundle/docs/home.mdx>.

Pages are MDX, so `<` and `{` in prose go in backticks or are escaped (`\<`, `\{`).

## Worker credentials

A worker's identity is an SSH key (R-BTN-13 as amended; R3-1239): `ssh-ed25519`,
`ecdsa-sha2-nistp256` or their `sk-` FIDO forms. Every `/v1/runner/*` call carries an RFC 9421
`Signature-Input` and `Signature` covering `@method`, `@authority`, `@path`, `@query` and
`content-digest` (the empty string's digest when there is no body), with `created`, `nonce`,
`keyid` (the key's `SHA256:` fingerprint) and `tag="baton-request"`; the signature value is an
SSHSIG in the namespace `baton-request` — what `ssh-keygen -Y sign -n baton-request` or an
ssh-agent makes. Baton refuses a signature more than 5 minutes from its clock, for another
origin, in another namespace, by an unknown or revoked key, or with a nonce it has seen for
that key in 10 minutes. The front checks the shape, `@authority` and the digest before the
object; the object checks the clock, the key, the signature and the nonce.

A repository's owner grants a key (below); until then, or for a machine no owner has granted, the
secret `BATON_KEYS` seeds worker keys at start:
`[{"key": "ssh-ed25519 AAAA… comment", "name": "<the one hostname it registers>",
"allowed_capabilities": ["capability", …]}]`. A seeded key the list no longer names is revoked,
for good; a machine whose key is lost gets a new one. An unset `BATON_KEYS` changes nothing (`[]`
revokes every seeded key), and a list that cannot be seeded changes nothing and shows under
Needs you.

**The transition.** A request with no signature headers may still use a bearer token: the
secrets `TOKEN_HASHES` (`{"<credential>": "<sha256 of its token>"}`) and `CREDENTIALS`
(`{"<credential>": {"hostname": "…", "allowed_capabilities": ["capability", …]}}`); removing a
credential's hash revokes it on its next call. Bearer tokens go once every worker signs.

After the first heartbeat a worker also presents the per-session secret it registered
(R-BTN-14). Only the credential named `test` may send `test_harness` (R-BTN-32).

## Administrators and owners

Whoever deploys Baton is its administrator (R-BTN-57): the secret `BATON_ADMIN_KEYS` (locally
`--admin-keys`) lists their keys, one per line, read on every request. Owners are per
repository (R-BTN-58), named by an administrator when it registers the repository. Each
administrator, owner and worker holds an SSH key or an API key, their choice (R-BTN-159). An SSH
key signs every request and reveals nothing reusable. An API key is a shared secret sent as a
bearer: easier to set up, but anyone who reads one request holds it until it is revoked. `baton
key create FILE` makes an API key on your machine. `FILE` holds the key (`-i FILE`, or a runner's
`IR_BATON_KEY_FILE`). `FILE.pub` holds its public line, which goes wherever an SSH public key
would: `BATON_ADMIN_KEYS`, `--owner-key` or a grant's `--key`. Sync, probe and courier keys stay
SSH keys. The CLI is the one path:

```
baton key create ~/.config/baton/admin --comment "admin"          # once; then:
npx wrangler secret put BATON_ADMIN_KEYS < ~/.config/baton/admin.pub
baton key create ~/.config/baton/ops_owner                        # the owner's own machine
```

```
baton admin -i ~/.config/baton/admin repo add immediately-run/ops --id ops --owner-key ops_owner.pub
baton admin -i ~/.config/baton/admin repo set docs --weight 2        # or --tiers routine,judgement,critical
baton admin -i ~/.config/baton/admin grant docs --key op.pub --hostname op-mac --capabilities human-operator
baton admin -i ~/.config/baton/admin revoke SHA256:…|bak_…           # any key, at once
baton admin -i ~/.config/baton/admin open                            # a one-time dashboard link (5 minutes)
baton owner -i ~/.config/baton/docs_owner grant docs --key vm.pub --hostname vm-a --capabilities agent-venue --max-tier judgement
baton owner -i ~/.config/baton/docs_owner bar docs --course '*' --tag account:go_plus --applies claim --starts-at 2026-10-17T00:00:00Z --reason go-quota
baton owner -i ~/.config/baton/docs_owner settings docs --required-bar '*' --course roadmap-pr --except implement,review,adjudicate --tag-prefix family: \
                                               --retry 1h,4h --max-failed 3
```

`--url` (or `BATON_URL`) picks the Baton. A key holds one role — administrator, owner, worker,
probe, courier or sync — and a key in a second is `conflict`. A granted key works only where it
is granted, with what that repository granted (rules 4 and 7) and under its `max_tier`; only an
administrator grants `human-operator`, or takes over a `BATON_KEYS`-seeded key. Owner bars join the posted barred tags of their course
(or every course, `*`), at claims and, with `--applies claim+advance`, advances; a leg missing a
required bar's tag prefix waits on `policy` under Needs you. Tiers, `retry` and
`transcript_repos` come only from Baton: a snapshot changes none of them. The dashboard shows them
under Limits, read-only.

The dashboard takes the `__Host-baton_session` cookie a login link sets (12 hours; it ends when
its key leaves `BATON_ADMIN_KEYS`). Cloudflare Access may stand in front as extra hardening; on its
own it opens the dashboard only while `BATON_ADMIN_KEYS` lists no key — a deployment from before
administrators — so set that secret, then log in with `baton admin open`.

## Repositories and their syncs

A repository is a forge path, a remote and a forge (BATON_SPEC §2k R-BTN-92): `forge` is `github`,
`gitlab`, `gitea` or `git`; `github` holds the forge path (`owner/name`, up to four segments on
GitLab); `remote` is what its sync and workers clone; `web_base` is its page, from which every link
Baton accepts or draws is built (`src/core/links.ts`). A `git` repository has no `web_base` and no
links. `BATON_REPOSITORIES` entries take `forge`, `remote`, `web_base`, `ci_identity` and
`sync_keys`; a GitHub entry may leave them out.

A sync or mirror authenticates (R-BTN-93) with a **sync key** — an SSH key registered for one
repository in one role, signing as workers do — or a CI identity token: GitHub Actions OIDC from
the repository's `sync_workflow`/`mirror_workflow`, or a GitLab CI `id_tokens` JWT whose audience
is `<origin>#sync` or `<origin>#mirror`, from an issuer `BATON_FORGE_SECRETS` lists
(`{"<repository>": {"forge": "gitlab", "gitlab_issuer": "https://gitlab.example.com"}}`). A key
holds one role: a sync key is never a worker's, nor the reverse.

## Stations and legs

A ticket rests at a **station** of its course file and a **leg** takes it to the next (BATON_SPEC
§2e). Each repository's sync places its tickets (`stations` in the board post, §7.1): the station,
the path of legs run so far, the queued leg, each next leg `ready` or `waiting`, and the tags
barred from each leg; Baton keeps that as a cache (`src/core/stations.ts`) and never computes a
station. docs' interim post, until R3-1233, places every ticket at its course's start with the
start leg ready when factory-state calls it ready.

A claim is at a station and runs at most one leg. `POST /v1/runner/claims/{id}/advance
{reached?, leg, evidence?, bars?}` finishes the running leg at `reached` and starts `leg`, on the
holder's word: Baton checks the edge and the leg's `max_runs` against the course file
(`src/core/graph.ts`) and the gates that bind a holder (`src/core/gates.ts`), never the leg's
state. An end rests at a station — the running leg's outcome, or its `from` if given up — and a
`suspended:<station>` is confirmed by the first snapshot observed after it whose path extends the
claim's expected path by edges. Matching (`GET /v1/runner/recommendations`) reads each
(repository, course) group 50 at a time in the default order — expedite, legs to an end, rank,
age, id — and merges the groups by weight; the order and the expedite lane's bound are advice,
recorded when a claim goes against them (`advice-overridden`), never refused.

## GitHub App webhooks

`POST /v1/github/webhook` takes the GitHub App's deliveries (R-BTN-73): `push`, `pull_request`,
`pull_request_review`, `issue_comment` and `workflow_run`, as JSON, and answers `204` (§11). The Worker verifies
`X-Hub-Signature-256` with the secret `BATON_GITHUB_WEBHOOK_SECRET` before reading anything
(no secret, no delivery is accepted), reads only the event, the delivery id,
`repository.full_name`, `workflow_run.path` and a push's `pusher.name` and
`head_commit.author.email`, and dispatches the sync of every registered repository whose tickets
name the delivery's repository — at most once per repository per 30 seconds, plus one trailing
dispatch when a window that suppressed a delivery closes. A repeated delivery id, a
`workflow_run` of a registered repository's own sync or mirror workflow, and the mirror's push
dispatch nothing.

## Running locally

For development and CI (BATON_SPEC §3a): the same core, on a SQLite file. It needs Node 22.13 or
later (`node:sqlite` without a flag).

```
npm run start:local -- --db ./baton.db --port 8787 [--origin <url>] [--admin-keys <file>] [--github-webhook-secret <file>] [--config <file>]
```

- `--origin` is the instance's own origin (default `http://<host>:<port>`): the OIDC audience,
  the dashboard's `Origin` check (R-BTN-56), and must be just that: scheme, host and port, no
  path. It is required with `--port 0`, or a `--host` that is not one IP address or
  `localhost`, where the address clients use cannot be derived.
- One process holds a `--db` file at a time: a second start on it fails.
- `--admin-keys` names a file of administrators' OpenSSH public keys, one per line (R-BTN-57).
- `--github-webhook-secret` names a file holding the GitHub App's webhook secret (R-BTN-73); it
  wins over `BATON_GITHUB_WEBHOOK_SECRET` in `--config`. Without either, every delivery is refused.
- `--config` names a JSON object holding the Worker's other variables and secrets — `OIDC_*`,
  `BATON_REPOSITORIES`, `ACCESS_*`, `OWNER_EMAILS`, `BATON_KEYS`, `TOKEN_HASHES`,
  `CREDENTIALS`, `BATON_GITHUB_WEBHOOK_SECRET`, `GITHUB_DISPATCH_TOKEN` — as strings. Without it every principal is unconfigured: the sync
  and the owner are refused and no worker token is known, so the example above serves only
  refusals. Nothing is read from `.dev.vars`, and the test bindings are refused.

One queue runs every request and alarm tick one at a time, as the Durable Object does. A local
Baton trusts the hooks of the repositories it serves (R-BTN-59): register only repositories
whose writers you trust.

## Deploying

`.github/workflows/baton-deploy.yml` runs the suite and then `wrangler deploy` (production,
`baton.immediately.run`) and `wrangler deploy --env staging`
(`baton-staging.immediately.run`) on every push to `main`. It needs the
`CLOUDFLARE_API_TOKEN` secret in the `production` environment (R3-1208): Workers Scripts: Edit
on the account, plus Zone: Read and Workers Routes: Edit on the `immediately.run` zone.

With a sibling docs checkout present, the suite also fails when `src/shared/` or the board
fixtures have drifted from docs.

## Releasing the CLI

A release is a PR that bumps `version` in `package.json` (and its two copies at the root of
`package-lock.json`: `npm install --package-lock-only`), merged to `main`. `ci.yml`'s `release`
job then waits for a reviewer's approval in the `npm` environment, tags `v<version>`, and runs
`npm publish` by OIDC trusted publishing, with provenance; no npm token exists. A version npm
already has is skipped, so a merge without a bump publishes nothing. `npm run check:package`
(in CI on every PR) packs the tarball, installs it in an empty directory and runs its `baton`.

The package's first version was published once by hand, because npm's trusted-publishing
setting exists only for a package that exists.

## License

Copyright 2026 Peter Neumark. Baton is licensed under the [Apache License, Version 2.0](LICENSE);
see [NOTICE](NOTICE).
