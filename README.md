# Baton

The immediately.run factory's live state — work-item leases, runners, providers and the
dashboard at `https://baton.immediately.run` — on a Cloudflare Worker and one SQLite
Durable Object.

The design is `BATON_SPEC`: [`spec/BATON_SPEC/`](spec/BATON_SPEC/), one file per section, indexed
by [`spec/BATON_SPEC.md`](spec/BATON_SPEC.md) (moved here from the `immediately-run/docs`
repository in R3-1252; split in B-179); the work is the tickets in [`tickets/`](tickets/). Where
an item says `infra/baton/<path>`, it means `<path>` in this repository (BATON_SPEC §3).

How Baton differs from a durable-execution engine such as Temporal, and where each fits:
[`docs/compared-to-temporal.mdx`](docs/compared-to-temporal.mdx).

## The CLI on npm

`@immediately-run/baton` is the `baton` command, published from this repository:

```sh
npx --yes @immediately-run/baton@0.1.4 run   # a runner (§6.13), with BATON_KEY_FILE set
```

From the package, `baton run`, `baton repo init`, `baton decision list` and the
`baton admin|owner …` API client work. Init names the commit the package was built from
(`dist/build.json`) as its courses' source and its workflow's pin, and copies the leg stubs and
instructions `build:cli` prebuilt into `dist/defaults/`, so it needs no checkout and no esbuild.
`--eject` copies prebuilt defaults the same way.

Owners, administrators and runners run a pinned release only — `npx --yes
@immediately-run/baton@<version>` (or an installed copy), never a checkout's CLI, whose code a
push changes (B-138): a working tree's CLI refuses an owner or administrator key unless `--dev`
is given, and `scripts/start-runner.sh` installs the pinned release outside every checkout it
works, probing that the release speaks the runner's interface before it starts. Pin a release
that carries these commands — 0.1.3 is the first (older ones, like 0.1.2, predate B-138's guard
and read the transition's `IR_BATON_*` credential names). In a checkout, `node cli/baton.mjs`
remains the development path — the repository commands (`tickets`, `repo`, `test-course`,
`request`) and the reads run from it, and the management commands with `--dev`.

`baton run --lock` (R-BTN-178) and its tests (`npm test`, `npm run model:pr`) need util-linux
`flock` on `PATH`; macOS has none — `brew install flock` gives one with the same flags.

## Layout

| Path | What |
|---|---|
| `src/core/` | Everything Baton decides, on either host (R-BTN-55): no platform import, checked by `test/unit/boundary-host.test.ts` |
| `src/core/ports.ts` | The platform services core takes: `Store`, `Scheduler`, `Clock`, `AdminKeys` (and `HumanKeys`, the same shape), `HookRunner`, `Dispatch`, `Gate`, and the instance's `Config` |
| `src/core/front.ts` | What stands in front of the core: verifies the principal (OIDC for the sync, Access for the owner, a signed request's shape for a runner, the App's signature for a webhook), sets the R-BTN-16 headers, serves the dashboard's static files, forwards the API |
| `src/core/baton.ts` | The core: migrations, board sync (§7.1), routing, the alarm, and `stateView()` — the whole state in one request, `GET /v1/admin/state`, an administrator's key's alone (R-BTN-57) |
| `src/core/actions.ts` | The action registry (§11.3 R-BTN-129): one table of every read a session shares with the keys and every route a session may call — id, method and path, callers, input, and `ui.view`, the screens that draw it as a control. The front admits a cookie from it, the reads authorize by it, `GET /v1/actions` answers from it |
| `src/core/reads/` | Every read a session may call, one module per domain (`tickets`, `runners`, `courses`, `conditions`, `sync`, `credentials`, `attestations`, `tenant`, …) behind one dispatcher (`index.ts`, which says how to add one): one principal, one authorization, the one refusal, the `ETag`; `kit.ts` holds the paging and query helpers, `src/core/cursor.ts` the opaque cursor |
| `src/core/runnerApi.ts` | The runner API (§8): heartbeat and registration, activities, messages, mode and shadow reports, the Runners view |
| `src/core/claims.ts` | The lease (§6, R3-1212): claim and end, matching (§7.2 rules 1–9 via `isEligible`), the alarm's reaps, the fence before re-issue, confirmations, git winning over a stale claim, the Running / Timeline / Needs you data |
| `src/core/attempts.ts` | Pure: the retry policy (§6.10 R-BTN-23) — which ends count, backoff, holds, the review-capacity run, the resume record (R-BTN-24) |
| `src/core/admin.ts` | Administrators and owners (R-BTN-57/-58, R-BTN-66/-67): repositories, probes, grants, owners, owner bars, required bars, `retry`, `transcript_repos`, login links and dashboard sessions — the one set of validated functions the signed `/v1/admin/*` and `/v1/owner/*` routes and the `baton` CLI share |
| `src/core/registry.ts` | The registered repositories (R-BTN-47): a checked, insert-only registration, the `BATON_REPOSITORIES` seed, the one repository a sync token binds to (R-BTN-15), qualified ticket ids (`docs:R3-1205`) |
| `src/core/cutover.ts` | The one-way cutover (R-BTN-28): `POST /v1/ui/cutover`, the legacy import, adoption on the owner's confirmation |
| `src/core/blocks.ts` | Why a ticket cannot move (§2g R-BTN-75, -77, -78): the one writer of `ticket_blocks` and `blocked_since`, the fleet counts, the `unblocked` messages and dispatch, and the `blocks` and `blocked` queries |
| `src/core/notices.ts` | Requests for people, in the retired sense of R-BTN-80 and R-BTN-103 (notice couriers, `/v1/courier/*`); the spec's replacement is R-BTN-163 — a `baton.*` condition on its resolve page and a delivery runner that reads `GET …/conditions` — and the code tickets remove this module with it |
| `src/core/history.ts` | Each ticket's history and Baton's disagreements with git (R-BTN-81, R-BTN-85): the one writer of `ticket_history`, `GET …/tickets/{ticket}/history`, the 90-day purge, and the `discrepancy` event and row logged before a snapshot's value is adopted |
| `src/core/resources.ts` | External resources (scope `account` or `service`), their account instances, the readings of runners, probes and administrators, and each instance's state (R-BTN-76, R-BTN-101) |
| `src/core/detailSchema.ts` | Pure: R-BTN-76's JSON Schema subset, interpreted (no code generation), for a reading's `detail` |
| `src/core/validate.ts` | Pure: every runner- and owner-supplied field checked before any write (§10.4) |
| `src/core/webhook.ts` | GitHub App deliveries (R-BTN-73): `X-Hub-Signature-256` before anything is read, the one parser of R-BTN-73's fields, repeat and own-work drops, the repository map, one sync dispatch per repository per 30 seconds plus a trailing one |
| `src/core/observations.ts` | The per-repository observation counter (R-BTN-62): `POST /v1/sync/observation` hands out the next number (`sync-busy` while one is outstanding, void after 10 minutes); a board post's number is used once and must be above the last accepted reading's |
| `src/core/courses.ts` | The course registry each sync posts (R-BTN-48): its shape check, each course file judged by `validateCourse` (a failing one keeps the previous and is listed under Needs you, R-BTN-69), the `min_runner_version` rule 9 reads (the older `min_worker_version` is still accepted) and each leg's expanded `requires` rule 4 and rule 11 read |
| `src/core/course.ts` | Pure: `validateCourse`, every way a course file breaks R-BTN-69's rules (stations reachable, an end from everywhere, cycles bounded, `start_leg`, inputs) |
| `src/core/queues.ts` | Legs are queues (R-BTN-79): the one writer of `leg_queues` — each ticket counted in its queued leg's queue while no claim holds it, moved in the transaction that changes it; a depth over `max_queue` logs `queue-over` and raises `baton.queue-over` (R-BTN-163; the code still queues the retired notice), and closes the course's intake (advice, never a gate) |
| `src/core/stats.ts` | A course's own record (§2d, R3-1248): `GET /v1/repositories/{repository}/stats` — per station and leg wait and run times, ends by reason and detail, suspensions, advice overridden, `off-graph` and foreign writes; aggregates and ids only |
| `src/core/board.ts` | Pure: snapshot validation, the `tickets` row an item becomes, peaks, prices |
| `src/core/auth.ts` | JWT verification (R-BTN-15, R-BTN-16); the one verifier of signed requests, SSHSIG over RFC 9421 (R-BTN-13); runner bearer tokens against `TOKEN_HASHES` during the transition |
| `src/core/stations.ts` | Where each ticket is, as its repository's sync places it (R-BTN-70, R-BTN-39): a cache each accepted snapshot overwrites, never computed; it notices an `off-graph` path and hands the claims what changed |
| `src/core/graph.ts` | Pure: a course file read as a graph (R-BTN-63/-64/-70/-71) — a leg's edge, the runs made of a leg, whether one path extends another, the legs from a station to an end, renamed names |
| `src/core/gates.ts` | Pure: what stays a gate (§7.2, R-BTN-45) — the rules refused at a claim and at an advance, in one function; the matching query in `claims.ts` is its mirror |
| `src/core/conditions.ts` | The raised conditions Baton holds (R-BTN-160, R-BTN-195, R-BTN-163's list): a runner's report of each raise, the Needs-you and list reads, and the closes |
| `src/core/conditionTypes.ts` | Pure: a condition's type vocabulary (R-BTN-160, R-BTN-195) — the grammar, the standard table, a type's disposition and the raise check |
| `src/core/questions.ts` | A person's leg and its question (§6.4 R-BTN-116): stored while the ticket's queued leg is a person's, listed under Needs you, answered by a `std:decision@1` applied as the leg's arrival (R-BTN-39) |
| `src/core/policy.ts` | The repository policy (§12.8 R-BTN-188, R-BTN-189): the knobs, presets, guarantees, approver lists and floors, the append-only `repository_policies` log, the protection reports (R-BTN-180) and the policy pins (R-BTN-182) |
| `src/core/codeRepos.ts` | The owners' code repositories (§3.4 R-BTN-140): the stored list and its pure checks, paths unique case-insensitively (R-BTN-92) |
| `src/core/provenance.ts` | Who last wrote each ticket (§4.4 R-BTN-194): `last_written_by`, read from the App's push deliveries (R-BTN-73), `pusher-unknown` when none accounts for a change; information only |
| `src/core/scope.ts` | A leg's scope audit (B-134): a runner's `scope-exceeded` report judged against the claim's scope, and `unclaimed-write` for a push no open claim's scope covers |
| `src/core/sequences.ts` | The per-repository, per-kind sequences (§4.3 R-BTN-199): the next ticket, rule, scenario, gate or migration number, `max(stored, floor) + 1` in one transaction |
| `src/core/stateVersion.ts` | `state_version` (§3 R-BTN-196): the `Store` wrapper for aggregate, scheduling and screen versions (R-BTN-196) |
| `src/core/retention.ts` | Retention (R-BTN-149): the alarm's batched prunes of old events and board snapshots, unseen runners' rows and purged tickets' claims |
| `src/core/instanceSettings.ts` | The administrators' instance settings (§13.1, R-BTN-57): `link_hosts`, `session_hosts` and `check_app_id` behind `PUT /v1/admin/settings`; `session_hosts` is what R-BTN-113's link rule reads |
| `src/core/mirror.ts` | What the git mirror reads and reports (§12, R-BTN-36): the event feed `GET /v1/sync/events`, the foreign-claim report, the workflows dispatched after a transition |
| `src/core/links.ts` | Link shapes (§2k R-BTN-92): forge paths, `web_base`, pull-request URLs, transcript repositories and file pages, on the one link rule in `src/shared/links.mjs` |
| `src/core/screens.ts` | The dashboard's one table of screens (§11.4): each path the front serves the shell at, its `ui.view` id (R-BTN-129) and the session role that may open it (R-BTN-155) |
| `src/core/http.ts` | Responses, errors and the R-BTN-16 headers (§10.5, §11), and the client versions stated on every `/v1` response (R-BTN-197) |
| `src/core/deprecated.ts` | The one writer of `deprecated-field` events (R-BTN-132's window): a retired field accepted and ignored, logged once per field, actor and day |
| `src/core/db.ts` | Shared helpers: the event log's one insert (`logEvent`), random hex, run ids (R-BTN-63), recognising a unique-index refusal |
| `src/core/text.ts` | Pure: §10.4's free text as one predicate (`isFreeText`) — a length, no control characters, none of `< > { }` |
| `src/cloudflare/` | The Cloudflare host: the Worker (`worker.ts`) and the `Baton` Durable Object (`baton.ts`), wiring `ctx.storage`, the alarm and `waitUntil` into the ports |
| `src/local/` | The local host: `node:sqlite` as the `Store` (`store.ts`), one queue for every request and alarm tick (`queue.ts`), a timer as the alarm (`host.ts`), `node:http` (`server.ts`), the command line (`main.ts`); the course test kit (`testCourse.ts`, R3-1248) |
| `src/runner/` | `baton run`'s runner loop (§6.13 R-BTN-72): the claim/leg loop (`runner.ts`), the pure result protocol (`protocol.ts`), the API client (`api.ts`), the state file and spool (`state.ts`), the home checkout's snapshot reads (`home.ts`), the leg child wrapper (`legProcess.mjs`), the CLI entry (`main.ts`) and `baton leg replay` (§9.8 R-BTN-84, `replay.ts`) |
| `src/migrations/` | Numbered schema migrations, applied before the object serves |
| `src/dashboard/` | The dashboard (BATON-UI-V2), in React 19 and TypeScript with no other runtime dependency: a walk down the entity tree — sign in, pick a repository, then one entity a screen. `app/` is the frame, the router, the sign-in and the controls drawn from the registry; `screens/` one folder per entity (`root`, `board`, `tickets`, `goals`, `courses`, `conditions`, `runners`, `credentials`, `governance`, `attestations`, `sync`, `tenant`), each registered in `screens/index.ts` under its id in `src/core/screens.ts` and kept to `screens/README.md`'s contract; `lib/` the shared pieces (`Text` and `View`, the polling store, the link rule). Every screen draws its entity's reads (`src/core/reads/`) and the registry entries `ui.view` places on it — never the whole state. Built by `npm run build:ui` (esbuild) into `src/dashboard/dist/` (gitignored): one bundle served as text by both hosts (R-BTN-55), never Workers assets |
| `test/ui/` | The dashboard's tests (vitest project `ui`, jsdom): each screen over a mocked `fetch`, the source gate (no markup-parsing API under `src/dashboard/**`, §12.3), hostile values through the real screens (S-BTN-76) and a screen drawing only its caller's actions (S-BTN-307) |
| `cli/` | `baton admin …` and `baton owner …` (`baton.mjs`); `baton decision list` (`decisions.mjs`, R-BTN-163's reader of what waits on a person; its courier half is R-BTN-80's retired sense): one request per command, signed with the key file `-i` names by `ssh-keygen -Y sign` (`sign.mjs`); `baton test-course`, which needs no Baton. The command tree the spec now defines is R-BTN-127's (`baton runner start`, `baton ticket …`, `baton course test`); the built names move to it under B-157 |
| `src/shared/` | Baton-owned modules used across components, including `schema.mjs`, the one validator of leg outputs and readings (R-BTN-108), and `std.mjs`, the `std:` library (R-BTN-110) |
| `src/vendor/` | Byte-identical copies from docs (R-BTN-37); never edit the copies here. `batonSync.mjs` is the board sync's decision code, which S-BTN-13 drives |
| `test/unit/`, `test/integration/` | Vitest; `S-BTN-n` scenarios in `integration/`. Project `cloudflare` runs everything in the Workers runtime; project `local` runs every scenario again on the local host, plus the Node-only tests |
| `test/integration/trace.ts` | R3-1244: every scenario's run on the local host as a trace — one step per request or alarm tick, with the state projection the formal model has — written to `test/.traces/` |
| `test/model/replay.test.ts` | R3-1244: traces drawn from `model/replay.qnt` drive the core, compared with the model's state at every step |
| `scripts/check-traces.mjs`, `scripts/check-model-links.mjs` | R3-1244: replay each scenario's trace through `model/baton.qnt` (`npm run traces`); check that every model action and its implementation name each other, with current hashes (`npm run model:links`) |
| `test/hosts/` | The two hosts the harness drives, behind one interface (`#host`) |
| `test/lib/fixtureRepo.mjs` | The harness's stand-in for `docs/main`: a real bare git repo |
| `tickets/` | The tickets wiki: Baton's tickets (`tickets/*.mdx`, finished ones in `tickets/archive/`) and their board, opened on immediately.run by Grove (below) |
| `docs/` | The documentation wiki: how Baton works and how to run it (below) |

## Commands

- `npm test` (the same as `npm run test:no-quint`) — the suite on both hosts, with a fake clock,
  and `model:links`, without Quint: no model-drawn replay, no `traces`, no `model:quick`. It is
  all hosted CI, the deploy run and `create-pr`'s `run-tests` gate run (R-BTN-68).
  `npx vitest --project local` (or `cloudflare`) runs one host; `npm run test:baton` is vitest alone.
- `npm run test:full` — the suite with Quint: the model-drawn replay, `traces` and `model:quick`
  (hours on a small machine). Quint runs only on the author's machine, when asked for: in
  `npm run test:full`, in `npm run model:pr` (about half an hour), whose report a PR
  that changes what the model checks read (the model, the core, the scenarios, …) carries in its
  body, and in the weekly `npm run model:full` on `main` (about three hours).
- `npm run test:load` — the load test (§15, R-BTN-87): the envelope's mix — 50 runners, 20
  repositories, a 5,000-ticket board post, 1,000,000 seeded history rows, bursts — on the local
  host, failing on any error or route over its latency budget and reporting the figures it
  reached (G-BTN-77). The Cloudflare budgets are read on production's own `capacity` log and
  live figures (B-224), never from a staging run.
- `npm run start:local -- --db <path> --port <n>` — Baton as a local process (below).
- `node cli/baton.mjs test-course <repository root> <course> [--base REF|none] [--board FILE]` — the course test kit
  (§2d, R-BTN-64/-65): the working tree's `.baton/` against REF's (default `origin/HEAD`, else
  `origin/main`; none resolving is an error, `--base none` skips the removal rule), run on a local
  Baton — the core accepts the file, the live tickets FILE places keep their paths, a removal raised
  `min_runner_version`, each `legs/` script pairs with a leg and exports `run`, `handoff` and
  `close`, and a ticket runs the shortest route to a confirmed done. Exit 1 names each violation.
- `npm run typecheck` — the Worker, the local host, the Node scripts and the dashboard.
- `npm run check:actions` — the action registry against the screen table (R-BTN-129): every
  `ui.view` names a screen of `src/core/screens.ts`, stands only on an entry a session may call,
  and every id is well-formed and listed once; it lists, without failing, the screens no control
  names.
- `baton admin -i <key> open` — the dashboard: a one-time link (5 minutes) that signs an
  administrator's browser in at the instance's origin (*Administrators and owners*, below).
  The screens are a tree: `/` lists the repositories; under `/repositories/{repository}/` are
  `board`, `tickets` and `tickets/{ticket}`, `goals`, `courses` and `courses/{course}`,
  `conditions` and `conditions/{condition}`, `runners` and `runners/{runner}`, the credentials
  (`grants`, `owners`, `tokens`, `mcp-keys`, `sync-keys`, `check-runners`), the governance screens
  (`policy`, `settings`, `bars`, `consents`, `attestations`) and `sync`; an administrator also has
  `/repositories`, `/instances`, `/resources`, `/capacities`, `/settings`, `/state` and
  `/sessions`. What a terminal reads in one request is `baton admin state`'s
  `GET /v1/admin/state`.
- `npm run build:ui` — the dashboard's one esbuild bundle into `src/dashboard/dist/` (gitignored):
  `app.js` and `app.css` with `index.html` copied beside them, served as text by both hosts and
  embedded in the published CLI. `npm test`, `npm run typecheck`, `npm run dev`,
  `npm run start:local` and `npm run build:cli` build it first (their `pre*` scripts), so a clean
  checkout works — and when `node_modules` does not hold what the lockfile locks for
  `package.json` (a tree restored from an older lockfile), `build:ui` installs the lockfile first
  (`npm ci --ignore-scripts`, B-132), so a stale one heals.
- `npm run model:links`, `npm run traces` — the code against the formal model (R3-1244; `model/README.md`).
  `npm run test:full` runs both after the suite, and the model's own checks; `npm run model:pr` and
  `model:full` run `traces` too, on a fresh set.
- `node cli/baton.mjs tickets new|claim|set|done` — file, claim and move tickets with git as the
  lock, each one commit pushed straight to the default branch from a throwaway worktree (B-112;
  `baton tickets --help`, and the generated `tickets/HOW-TICKETS-WORK.md`), until Baton claims
  them (R3-1266). Every ticket commit pushed by these commands or `baton request` carries the
  provenance trailers `TICKET_TRAILERS` holds, appended after a blank line (B-16, B-251) — the
  handoff's commit rule: the agent-provenance
  trailers, then `Claude-Session` and `Co-Authored-By`, taken whole as docs' `claim.sh` takes
  `CLAIM_TRAILERS` and baton computes none of its own — and with `TICKET_REQUIRE_TRAILERS=1`, a
  command without trailers refuses rather than push a commit that cannot be attributed. `claim`
  asks Baton first (B-129): with the session's key (`-i KEY`, else
  `BATON_KEY_FILE`) it reads the ticket's position from Baton's board and history, continues a
  ticket past its course's start where Baton holds it (the PRs written back, the position
  printed) instead of starting over — overriding only a false `available`, never the git lock or
  a parked or closed status — and refuses, rather than trust the frontmatter, when a read cannot
  be answered (`--offline` for an unreachable Baton). A release (`set <id> available
  [--note TEXT]`) keeps every `prs:` entry and its commit is the hand-off. `claim` also refuses a ticket
  citing a rule whose `spec/BATON_SPEC_HISTORY.md` entry, by its title, amended it after the ticket was filed or last re-read it, until
  `--rules-reread <id>,…` names exactly those ids (R-BTN-74); in a shallow clone it deepens the
  clone first. A new migration or scenario number is the next free one at merge (B-176 moves it
  into Baton).
- `npm run check:wiki` — every page in `tickets/`, `docs/` and `spec/` compiles as MDX, uses only known
  components and links only to files that exist; every ticket matches `tickets/item.schema.json`.
- `npm run check:tickets` (or `node cli/baton.mjs tickets check [--repo DIR]`) — check this
  repository's ticket source without posting it, as `baton repo sync` reads it: the board post's
  validation, every `depends_on` target and dependency cycle, and — with
  `check.depends_line` in `.baton/baton.json` — each ticket's `**Depends on:**` line against its
  `depends_on` (B-111); with `check.sections_since`, a ticket filed on or after that day (the
  later of its `_filed` line and its first commit) whose `### Trust` or `### Invariants` is absent,
  empty or a placeholder (R-BTN-74), request tickets and leg-filed children aside; with
  `check.sections_from_id` (here `B-176`), a ticket at or above that id without a `_filed` line.
  One `path: message` line per finding, exit 1 with findings; CI runs it on `tickets/`. CI's
  clone is depth 1, so there it judges the tickets from `B-176` on by their `_filed` lines and
  only lists, as undetermined, an older ticket without one. It also lists, never as a finding,
  the live tickets citing a rule amended since they were filed or re-read it (`check.rules`), and
  says so when a shallow clone skips that list.
- `node cli/baton.mjs request "<one sentence>" --course C [--repo DIR] [--tier T] [--branch B]` —
  start a course whose product is a spec or a ticket — `create-spec`, `build-app` — from one
  sentence (B-98). Files one request ticket (the sentence as title and description, `course: C`,
  `tags: [request]`, the next free id under the repository's own prefix) as one commit pushed straight to the repository's default
  branch, retrying on a moved head; prints the ticket id and the course's first station. A
  repository command, not an API call: the push triggers the sync, the board places the ticket, and
  the next claim starts the course. The course's file must say `starts_from: request`.
  `docs/standard-courses.mdx` has the pattern.
- `npm run vendor` — re-copy the files `src/vendor/manifest.json` lists (`baton.mjs`, `vocabulary.mjs`,
  `sessionUsage.mjs`, `batonSync.mjs`, `ticketPr.mjs`) from a sibling `../docs`
  checkout (or `DOCS_DIR`) and rewrite `src/vendor/manifest.json`. Do this in a PR here after
  docs changes any of them.
- `npm run fixtures` — regenerate `test/fixtures/boards.json` with the real docs
  `factory-state` code.

## The wikis

The repository holds three [Grove](https://github.com/immediately-run/grove) wikis, which
immediately.run opens: `package.json`'s `"immediately.run": {"content": ["tickets", "docs", "spec"]}`
lists them, and each folder's `immediately.run.json` opens it with the viewer it names —
`tickets/` with `immediately-run/baton-board` (B-114), `docs/` and `spec/` with the wiki viewer.

- **`tickets/`**, the tickets:
  <https://immediately.run/present/github/immediately-run/baton/main/bundle/tickets/home.mdx>.
  A ticket is `tickets/<id>.mdx`. New tickets are `B-n`; tickets that moved here from the
  immediately.run docs roadmap keep their `R3-NNNN` ids. A finished one moves to
  `tickets/archive/` with `status: done`. A ticket on a course whose file says
  `starts_from: request` — `create-spec`, `build-app` — is usually filed by `baton request`
  (above), never written by hand. Its frontmatter follows `tickets/item.schema.json`;
  the body is prose for people and agents. The wiki is a plain `render: safe` corpus: its board
  components are the viewer's, `immediately-run/baton-board`, which `tickets/immediately.run.json`
  names in `opensWith` (B-114) — this repository holds no component code for it.
- **`docs/`**, the documentation:
  <https://immediately.run/present/github/immediately-run/baton/main/bundle/docs/home.mdx>.
- **`spec/`**, the specification (B-180):
  <https://immediately.run/present/github/immediately-run/baton/main/bundle/spec/home.mdx>.
  Its pages are `.md`: `BATON_SPEC.md` (the generated index), `BATON_SPEC/` (one file per
  section), the history and the MCP OAuth companion. Tickets and docs link a section by a relative
  path to its file and heading (`node scripts/link-spec-refs.mjs` writes them).

Pages are MDX, so `<` and `{` in prose go in backticks or are escaped (`\<`, `\{`).

## Runner credentials

A runner's identity is an SSH key (R-BTN-13 as amended; R3-1239): `ssh-ed25519`,
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
secret `BATON_KEYS` seeds runner keys at start:
`[{"key": "ssh-ed25519 AAAA… comment", "name": "<the one hostname it registers>",
"allowed_capabilities": ["capability", …]}]`. A seeded key the list no longer names is revoked,
for good; a machine whose key is lost gets a new one. An unset `BATON_KEYS` changes nothing (`[]`
revokes every seeded key), and a list that cannot be seeded changes nothing and shows under
Needs you.

**The transition.** A request with no signature headers may still use a bearer token: the
secrets `TOKEN_HASHES` (`{"<credential>": "<sha256 of its token>"}`) and `CREDENTIALS`
(`{"<credential>": {"hostname": "…", "allowed_capabilities": ["capability", …]}}`); removing a
credential's hash revokes it on its next call. Bearer tokens go once every runner signs.

After the first heartbeat a runner also presents the per-session secret it registered
(R-BTN-14). Only the credential named `test` may send `test_harness` (R-BTN-32).

## Administrators and owners

Whoever deploys Baton is its administrator (R-BTN-57): the secret `BATON_ADMIN_KEYS` (locally
`--admin-keys`) lists their keys, one per line, read on every request. Owners are per
repository (R-BTN-58), named by an administrator when it registers the repository. Each
administrator, owner and runner holds an SSH key or an API key, their choice (R-BTN-159). An SSH
key signs every request and reveals nothing reusable. An API key is a shared secret sent as a
bearer: easier to set up, but anyone who reads one request holds it until it is revoked. `baton
key create FILE` makes an API key on your machine. `FILE` holds the key (`-i FILE`, or a runner's
`BATON_KEY_FILE`). `FILE.pub` holds its public line, which goes wherever an SSH public key
would: `BATON_ADMIN_KEYS`, `--owner-key` or a grant's `--key`. Sync and probe keys stay
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

`--url` (or `BATON_URL`) picks the Baton. A key holds one role — administrator, owner, runner,
probe, courier or sync — and a key in a second is `conflict`. A granted key works only where it
is granted, with what that repository granted (rules 4 and 7) and under its `max_tier`; only an
administrator grants `human-operator`, or takes over a `BATON_KEYS`-seeded key. Owner bars join the posted barred tags of their course
(or every course, `*`), at claims and, with `--applies claim+advance`, advances; a leg missing a
required bar's tag prefix waits on `policy` under Needs you. Tiers, `retry` and
`transcript_repos` come only from Baton: a snapshot changes none of them. The dashboard shows them,
read-only, on a repository's credential and governance screens (`…/grants`, `…/owners`,
`…/settings`, `…/bars`); the CLI changes them.

The dashboard takes the `__Host-baton_session` cookie a login link sets (12 hours; it ends when
its key leaves `BATON_ADMIN_KEYS`). Behind Cloudflare Access, a person whose verified email is
bound to an administrator key by `ACCESS_IDENTITIES` can click **Sign in with Cloudflare Access**
at `/login` instead. The session also ends when that binding is removed or changed. See the
[deployment runbook](docs/runbooks/register-baton.mdx) for configuration and trust requirements.

## Repositories and their syncs

A repository is a forge path, a remote and a forge (BATON_SPEC §2k R-BTN-92): `forge` is `github`,
`gitlab`, `gitea` or `git`; `github` holds the forge path (`owner/name`, up to four segments on
GitLab); `remote` is what its sync and runners clone; `web_base` is its page, from which every link
Baton accepts or draws is built (`src/core/links.ts`). A `git` repository has no `web_base` and no
links. `BATON_REPOSITORIES` entries take `forge`, `remote`, `web_base`, `ci_identity` and
`sync_keys`; a GitHub entry may leave them out.

A sync or mirror authenticates (R-BTN-93) with a **sync key** — an SSH key registered for one
repository in one role, signing as runners do — or a CI identity token: GitHub Actions OIDC from
the repository's `sync_workflow`/`mirror_workflow`, or a GitLab CI `id_tokens` JWT whose audience
is `<origin>#sync` or `<origin>#mirror`, from an issuer `BATON_FORGE_SECRETS` lists
(`{"<repository>": {"forge": "gitlab", "gitlab_issuer": "https://gitlab.example.com"}}`). A key
holds one role: a sync key is never a runner's, nor the reverse. Register one with
`baton admin repo add … --sync-key <the key's .pub>` (or `repo set <id> --add-sync-key`), beside
the CI identity when the repository has one, and post its board without CI by
`baton repo sync --sync-key FILE` — or `BATON_SYNC_KEY=FILE`, which is the same flag from the
environment (B-88). The flag signs the sync's observation, head and board calls as a runner signs;
it is the path for a repository without Actions, or for bootstrapping a first board.

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
dispatch nothing. The dispatch goes out whatever the repository's mode (§7.1 R-BTN-73): the sync
posts the board snapshot before the cutover too.

## Running locally

For development and CI (BATON_SPEC §3a): the same core, on a SQLite file. It needs Node 22.13 or
later (`node:sqlite` without a flag).

```
npm run start:local -- --db ./baton.db --port 8787 [--origin <url>] [--admin-keys <file>] [--github-webhook-secret <file>] [--config <file>] [--event-archive <file>]
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
  and the owner are refused and no runner token is known, so the example above serves only
  refusals. Nothing is read from `.dev.vars`, and the test bindings are refused.

One queue runs every request and alarm tick one at a time, as the Durable Object does. A local
Baton trusts the hooks of the repositories it serves (R-BTN-59): register only repositories
whose writers you trust.

## Deploying

`.github/workflows/baton-deploy.yml` runs the suite and then `wrangler deploy` (production,
`baton.immediately.run`) on every push to `main`. There is no staging instance: a home
repository binds to one Baton, and every registered one binds to production (B-224). It needs
the `CLOUDFLARE_API_TOKEN` secret in the `production` environment (R3-1208): Workers Scripts:
Edit on the account, plus Zone: Read and Workers Routes: Edit on the `immediately.run` zone.

With a sibling docs checkout present, the suite also fails when `src/vendor/` copies or the board
fixtures have drifted from docs.

### Event archive

Event deletion is off by default (R-BTN-149). To enable it on Cloudflare, bind a private R2
bucket as `BATON_EVENT_ARCHIVE` with `[[r2_buckets]]` in the deployment's Wrangler configuration.
Use one bucket per instance and do not expire the archived objects. Each tick appends NDJSON
pages to `events/<repository>/<UTC day>.ndjson` by conditionally replacing the daily object.
If a write fails (including if the daily object exceeds R2's single-write limit), the entire
event batch stays in SQLite.
On the local host, pass `--event-archive <file>` to append and sync to a separate private NDJSON
file in an existing directory on durable storage. Existing files must not grant group or
other access. Do not share the file between instances or point it at SQLite files.

Each line is a mirror feed page (`events`, `next`, `cutover_at`) plus its `repository`.
The event records use the feed's projection, including for kinds the live feed omits.
For replay, collect the pages for the repository, order events by `seq`, and deduplicate by
`seq`: storage can acknowledge a batch even if the alarm did not get to delete it. A local
append interrupted by a crash can leave an incomplete final line; the next append removes
that tail before retrying the rows.

## Moving a Baton (R-BTN-88)

Owner state — the settings, keys, grants, bars, holds and closed tickets git does not hold —
moves between Batons as one file; the tickets and readiness rebuild from git at the target's
first sync. The tenant's administrator drives it (BATON_SPEC §4.8):

1. `baton admin -i KEY freeze` — new claims and owner writes are refused `frozen`; the work
   holding claims drains, its lease upkeep untouched. `baton admin -i KEY unfreeze` undoes it
   before the seal.
2. Let the claims drain and the mirrors catch up (`GET /v1/sync/events` acknowledges each
   mirror's cursor), then `baton admin -i KEY seal`. A seal with work left is `conflict`,
   naming the claims and the lagging mirrors; an administrator's fence clear runs while frozen.
   From the seal the source logs nothing and serves nothing but an administrator's read.
3. `baton admin -i KEY export [--with-history]` — `baton.owner-state/v1`, deterministic, its
   digest over the RFC 8785 canonical JSON of the rest; the CLI writes it mode `0600`.
   `--with-history` adds the ticket history and the outputs and inputs replay reads.
4. Provision the target (a FRESH Baton — the import is into an empty one), then
   `baton admin -i KEY import FILE`. One transaction: the digest and the schema version are
   checked, every row through the write path's invariants, the runners resume unkeyed, the
   event sequence continues from the source's, and each repository's first snapshot applies the
   ticket-scoped rows (holds and overrides) to the tickets it posts — or drops and logs the
   ones it does not.
5. Keep the origin (move DNS), or give each repository the new `baton_url` and repoint every
   sidecar — signatures are bound to the origin. The sealed source never serves again; an
   abandoned move is finished by importing into a fresh Baton at the source's origin.

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
