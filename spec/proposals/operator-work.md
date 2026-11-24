---
title: "Proposal — operator work: a person signs in, takes an operator leg, and works it in their own session or a sandboxed one"
description: "Not built: operators as a person's own runner key that owners name on a repository; sign-in from the CLI, the dashboard and a local MCP server; OP scoped to a course's operator legs; a read of the operator work that is otherwise unblocked; taking a leg into the person's own agent session; and an order that has a launcher start a sandboxed opencode session whose link the person gets at once."
---
# Proposal — operator work

**Status:** proposal, not built. Filed 2026-11-24 from the owner's request below. The tickets that
build it are the `operator-work` project's (B-327 to B-333); B-327 moves the parts below into the
sections they extend and gives each new rule its id. Until then, a new rule here is named, not
numbered, and every rule it changes is listed in [Amends](#amends).

**Its home when built:** §11.2 (operators, beside R-BTN-58), §11.4 (the operator's session, beside
R-BTN-155), §6.1 (leg-scoped ticket requirements, R-BTN-120), §5 (a course's `operator_legs`,
R-BTN-69), §8.3 (the operator runner, beside R-BTN-72; orders, beside R-BTN-201), §13 and §14.

## The goal

The owner, 2026-11-24:

> Baton is also missing a good workflow for operator tickets. It should be possible for a user to
> sign in to Baton (via CLI, web UI or MCP) for interactive operator work, taking an -otherwise
> unblocked- operator ticket and completing it in their agent session (MCP) or triggering a
> sandboxed opencode leg which they immediately get a link to so they can attach to the session
> and resolve the operator leg interactively.

## What exists today (2026-11-24)

- **`human-operator` is a capability.** It is the built-in bare name a runner declares and a grant
  admits like any other ([R-BTN-121](../BATON_SPEC/05-courses.md#sec-5-6),
  [R-BTN-58](../BATON_SPEC/11-people.md#sec-11-2)). Rule 4 matches it by name, and Baton never
  checks that a person is there (values 12). The `OP` tag is `human-operator` in the ticket's
  `requires`. The ticket's clause joins *every* leg of its course
  ([R-BTN-120](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-1)). So an `OP` ticket on
  `create-pr` needs a `human-operator` runner for its review, merge and confirm legs too.
- **Only a machine can hold a lease.** A claim is a runner's: a key, a heartbeat and a runner
  secret ([§8.1](../BATON_SPEC/08-runners.md#sec-8-1)). A person who wants an operator leg today
  configures a runner (`baton runner start` with a key granted `human-operator`). That runner
  then claims whatever operator work comes first. No route lets a signed-in person pick one
  ticket.
- **People sign in only as administrators.** Administrators' dashboard sessions are built
  ([R-BTN-155](../BATON_SPEC/11-people.md#sec-11-4)). Owners' code sign-in is proposed
  ([people and dashboard §3](people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions),
  B-76). So are registration tokens, the way a person with no key gets one
  ([checks and executors §5](checks-and-executors.md#5-grant-acceptance-span-and-registration-tokens-r-btn-146-r-btn-117-proposed)).
  The remote MCP endpoint and its delegated keys act as an owner, never as a runner (R-BTN-130,
  R-BTN-186; B-25, B-73).
- **Joining a running leg is built.** A non-autonomous leg with a deadline raises `interact`
  ([R-BTN-195](../BATON_SPEC/07-conditions.md#sec-7-1), built by B-234). Baton lists it under
  Needs you with the run's session link ([R-BTN-113](../BATON_SPEC/08-runners.md#sec-8-3)).
  B-312 limits who may read that link. On a Fieldhouse host a joinable leg's link is its leg page,
  which frames the opencode session (FIELDHOUSE_SPEC R-FH-80).
- **A launcher can find work, but not a person's request.** `GET /v1/runner/launch-candidates`
  is built ([R-BTN-99](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-7)). The launcher
  itself and its hint naming a ticket are proposed
  ([R-BTN-201](../BATON_SPEC/08-runners.md#sec-8-3),
  [checks and executors §7](checks-and-executors.md#7-the-launcher-r-btn-201-proposed)). No
  candidate says that a person asked for it.
- **The attached executor and the ending verbs are proposed.** The `attached` executor hands a
  leg to the agent session that hosts the runner. The verbs `baton leg done`, `suspend` and
  `release` end it. Only `raise`, and `done` on the channel, are built
  ([checks and executors §2.3, §6](checks-and-executors.md#23-the-shipped-session-and-attached-executors)).

Five gaps follow:

1. A person has no identity that can hold a lease.
2. `OP` puts the person on every leg.
3. No read lists the operator work a person could take now.
4. There is no way to take one ticket into the session the person is already in.
5. There is no way to ask for a sandboxed session and get its link.

## The design

### 1. Operators: a person's own runner key

- **An operator is a person an owner names on a repository.** The owner names them with
  `baton owner operator add <repository> <name> (--key <public key or fingerprint> | --token)
  [--email <address>] [--capabilities <c,…>] [--max-claims <n>]`. The entry is stored in Baton
  (`repository_operators`) and no push changes it (values 1).
  - `<name>` matches `^[a-z][a-z0-9-]{0,31}$`.
  - The email, when given, is stored only as its lowercased SHA-256, for Access sign-in (§2).
  - `remove` revokes the entry and its grant.
- **The operator's key is a runner credential.** It is an SSH machine-key credential
  ([R-BTN-102](../BATON_SPEC/08-runners.md#sec-8-2)) registered under the hostname `op-<name>`.
  Its grant on the repository carries the mark `operator: <name>`.
  - Its capabilities default to `human-operator` plus what the owner lists, and `max_claims` to 1
    ([R-BTN-4](../BATON_SPEC/09-claims.md#sec-9-1)).
  - It is never an owner or administrator key, never `human_only` (R-BTN-185), and never a
    `trusted-runner` (R-BTN-182). An operator key is meant to sit where an agent can read it, so
    it satisfies no human gate.
- **Enrolment without a key** uses a registration token
  ([R-BTN-117](checks-and-executors.md#5-grant-acceptance-span-and-registration-tokens-r-btn-146-r-btn-117-proposed))
  that an owner mints with `--operator <name>`.
  - `baton operator login --token brt_…` generates an Ed25519 key in
    `~/.config/baton/operator/`, mode 0600, and registers its public half inside the token's
    scope.
  - The token's uses default to 1.
- **Every runner and claim of an operator key names the person.** The runner row and each claim
  carry `operated_by: <name>`, shown on Board, Runners and the ticket's history. It is
  information only, never a gate.

### 2. Signing in, per surface

| Surface | First time | Afterwards |
|---|---|---|
| CLI | `baton operator login --token …`, or `baton operator login --key <path>` for a key the owner added; it checks the key against Baton and writes `~/.config/baton/operator.json` (origin, key path, repositories) | the key signs each request |
| Dashboard | `baton operator open`: people and dashboard §3's code flow with the role `operator`, confirmed with the operator key; or Cloudflare Access with the email the owner listed | a session of role `operator`, 4 hours |
| MCP | the harness starts `baton mcp operator` (§5), which uses the CLI's login | the server's own runner |

**An operator's session** is the principal `session` with the role `operator` (R-BTN-129).

- It reads what a key granted on the repository reads (B-192's reads), and the operator work (§4).
- It places and cancels its own orders (§6).
- It reads the session links of its own claims and orders (B-312).
- It takes no owner action.
- It holds no lease: from the dashboard, a sandboxed session is an order, and the person's own
  session is the CLI or MCP.

### 3. Operator legs: `OP` scoped to the legs a person works

- **A ticket requirement may be scoped to legs.** A ticket source may post
  `requires: [{capability, legs: [<leg>…]}]` beside plain names, which still mean every leg.
  - `ticket_requires` gains a `leg` column; NULL means every leg.
  - Rule 4 joins a leg only with the ticket's rows for that leg.
  - The blocks read (R-BTN-75) names a scoped requirement only on its legs.
- **A course names its operator legs.** The course-file key is `operator_legs`, a list of the
  course's runner legs; it defaults to `[start_leg]`.
  - The validator refuses a person leg or an unknown leg in it (R-BTN-69).
  - The markdown source writes the `OP` tag as `human-operator` scoped to the course's
    `operator_legs`.
  - A ticket that wants a person on every leg writes `requires: [human-operator]` in its
    frontmatter, unscoped.
- **The standard courses' operator legs.** In `create-pr` they are `implement` and `fix`, so
  `review`, `merge` and `confirm` go to agents. In `review-pr` it is the start leg.

### 4. Operator work: what a person could take now

- **The read.** `GET /v1/repositories/{repository}/operator-work`, action `operator.work`. It may
  be called by an operator's key or session, and by an owner's or administrator's session, which
  sees it for every operator. It lists each ticket that meets all three of:
  - its queued leg requires `human-operator`, from the ticket or the leg;
  - it passes every gate of §6.6 for a runner declaring the caller's grant capabilities, except
    rule 1's lease. This is computed by the same `isEligible` the claim uses, never by a second
    matcher (G-BTN-40);
  - it is not held by another claim.
- **What each entry carries.**
  - The ticket, its title, course, station, queued leg and `ready_since`.
  - The leg's `deadline_s`, and `orderable` when it has one (§6).
  - Its open order, if any.
  - The claim, when the caller holds it.

  Entries come in §6.6's default order.
- **Other blocks.** `?blocked=1` adds the operator legs that something else blocks, each with its
  R-BTN-75 blocks, so a person sees why a ticket they expected is not offered. Without it, the
  list is the otherwise-unblocked work the owner asked for.
- **Its surfaces.** `baton operator list [<repository>]`, the MCP tool `operator_work` and the
  dashboard's Operator screen (§7) all draw this one read.

### 5. Taking one into the person's own session

- **The operator runner.** It is a CLI runner ([R-BTN-72](../BATON_SPEC/08-runners.md#sec-8-3))
  run by the operator's key, with these settings:
  - the `attached` executor;
  - concurrency 1, in the current checkout, which must be a clone of the home (R-BTN-143 checks
    the claim's commit);
  - a session name `op-<random>`.

  It **only claims by name** ([R-BTN-100](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-7)'s
  `ticket_id`) and never makes an unnamed claim. This is the runner's discipline, not a gate
  (values 12).
- **`baton operator take <repository>:<ticket> [--leg <leg>] [--detach]`.**
  - **Taking.** It claims, sends the first `advance`, and prints the leg's brief:
    - the leg's instructions and the ticket file's path;
    - the newest hand-off and the resume record, as data (R-BTN-144's `BATON_RESUME`);
    - the leg's deadline;
    - the commands that end it.
  - **Holding.** It heartbeats until the leg ends: in the foreground, or with `--detach` as a
    background process that `baton operator status` and `stop` find through its state file.
  - **Ending.** The person, or their agent, ends the leg from any shell in the checkout with
    `baton leg done --reached <station> --next <leg> [--output …]`, `baton leg suspend` or
    `baton leg release`. The channel's address comes from the operator runner's state directory.
    The runner then:
    1. checks the move (R-BTN-106);
    2. runs `close`, then `handoff` where the leg suspends or releases;
    3. sends `advance` or `end`.
  - **After the leg.**
    - If the next leg is an operator leg, the runner offers to go on (`--chain` does so without
      asking).
    - Otherwise it ends the claim suspended at the reached station, so the next leg is offered to
      agents ([§9.4](../BATON_SPEC/09-claims.md#sec-9-4)).
- **`baton mcp operator`, a local MCP server that is the runner.** The person's harness starts it
  as a stdio MCP server from the user-scope configuration (Claude Code, opencode). The server is
  the operator runner and its process is the sidecar.
  - **Liveness.** It is alive while the harness is. When the harness closes its stdin, it drains
    as SIGTERM does (R-BTN-72): the leg in flight is released at its next safe point with a
    hand-off, so a closed session gives the ticket back within seconds, not at the lease's end.
  - **Tools.**
    - `operator_work` (§4);
    - `operator_take {ticket, leg?}`, which answers the brief;
    - `operator_status`;
    - `leg_done {reached, next, outputs?}`, `leg_suspend {reached, detail?}` and
      `leg_release {reason}`, each checked as the channel checks it;
    - `leg_raise`;
    - `operator_order {ticket}` and `operator_order_status {order}` (§6).
  - **The checkout.** It is the server's working directory. A take from a directory that is not a
    clone of the home is refused `not-a-checkout`.
  - **The agent never receives the runner secret or the claim's nonce.** The key itself is on
    disk where the agent can read it. The first take in each session answers, before the brief,
    the warning that the intervention proposal settled for MCP
    ([the owner's decision 3](intervention-sessions.md#the-owners-decisions)): "This agent can
    use your operator key: a session that holds no owner key or owner forge credential is
    strongly advised."
- **The skill.** `skills/baton-operator/SKILL.md`, shipped in the package, tells an agent how to
  work an operator leg: read the brief, work with the person, show them the result, and call
  `leg_done` only once they confirm it.

### 6. Taking one into a sandboxed session: orders

- **An order is a person's request that a launcher start a sandboxed session** for one ticket's
  queued operator leg.
  - **Route.** `POST /v1/repositories/{repository}/orders {ticket, leg?}`, action
    `operator.order`. It may be called by an operator's key or session, from the CLI
    (`baton operator order`), MCP or the dashboard.
  - **Refusals.**
    - The leg is not queued, not ready, or does not require `human-operator`: `invalid-params`.
    - The leg has no `deadline_s`, so it cannot be joined (R-BTN-195): `invalid-params`, reason
      `not-joinable`.
    - The caller's grant does not admit the leg's capabilities: `forbidden`.
    - The ticket is held, or already has an open order: `conflict`, naming the holder or the
      order.
- **What Baton stores** (`operator_orders`):
  - the id `ord_` plus a ULID;
  - the ticket, the leg and `requested_by` (the operator's name);
  - `created_at` and `expires_at` (15 minutes unless claimed);
  - the `claim_id`;
  - the state: `waiting`, then `starting` once a claim names it, then `joinable` once that claim's
    leg has a stored session link, then `closed` with an outcome of `done`, `suspended`,
    `released`, `expired`, `cancelled` or `taken` (another claim took the ticket).
- **An order reserves nothing** (R-BTN-201). Any eligible runner may still claim the ticket. The
  order then closes `taken`, and the requester sees who took it.
- **The link, at once.**
  - **The reply** carries `{order, order_url}`, where `order_url` is
    `<origin>/repositories/{repository}/orders/{order}`. The person has a link before any session
    exists.
  - **The read.** `GET /v1/repositories/{repository}/orders/{order}` (action `order.show`)
    answers the state. It adds `session_url` once joinable, for the requester's key or session and
    for owners' and administrators' sessions only (B-312's rule, widened to the requester).
  - **Waiting for it.** `baton operator order <ticket> --wait` polls the read with its ETag until
    the order is joinable, then prints the link and how to attach (the executor's link: on a
    Fieldhouse host the leg page; for a bare `opencode serve`, `opencode attach <url>`). The MCP
    tools answer the order's URL at once and its state on each status call.
- **How a launcher serves an order.**
  - `launch-candidates` lists open orders' legs first, each carrying `order: {id, requested_by}`
    (R-BTN-99).
  - A launcher that serves orders starts a session in its sandbox with the hint
    `{ticket, leg, order}`.
  - Its runner claims with `ticket_id` and `order: <id>`. Baton stores `claims.order_id` and moves
    the order to `starting`. A claim naming an order that is closed or for another ticket is
    granted or refused as usual; the order part is dropped and logged `order-ignored`.
- **The ordered runner's discipline** (runner code, never a gate):
  - **One leg.** It claims only the order's ticket, runs only the order's leg, ends its claim at
    the leg's end (suspended at the reached station, or `done`) and exits.
  - **A joinable executor.** It runs the leg under an executor whose handle names a link
    (R-BTN-107): Fieldhouse's joinable opencode session (R-FH-80), or any executor that does the
    same.
  - **The link at once.** When the link is known it heartbeats at once rather than at the next
    2-minute beat, so the link reaches the order within seconds (R-BTN-113).
  - **`interact` on the leg's behalf.** It raises `interact` for the leg (R-BTN-195), so Needs
    you and delivery runners carry the same link.
  - **The person attaches.** The agent's brief says a person will join (`brief.operator: {name}`,
    a hint). The person attaches through the link and works the leg with the agent. One of them
    posts `baton leg done` in the session, and the runner stops it (R-BTN-107).
- **Who declares `human-operator` in a sandbox.** The launcher's runner key is granted
  `human-operator` by the owners, as any key is (R-BTN-58).
  - Its runner declares it only in a session started for an order: the launcher's statement that
    a person asked and is joining. Baton records the order and its requester on the claim and
    checks nothing (values 12).
  - A person who orders and never joins leaves the leg to fail at its deadline (R-BTN-90), as an
    unanswered `interact` does today.
- **Cancelling.** `DELETE /v1/repositories/{repository}/orders/{order}` (action `order.cancel`)
  may be called by the requester or an owner. A waiting order closes `cancelled`. A claimed
  order's cancel also sends its claim a `release` message, so the runner releases at its next
  safe point with a hand-off (§9.4, `released:requested`).
- **A reference launcher**, for a deployment with none:
  `baton launcher --orders --start '<command>'`.
  - It polls `launch-candidates` with its ETag and runs the command once per open order, with
    `BATON_ORDER`, `BATON_TICKET` and `BATON_LEG` set.
  - It keeps R-BTN-201's own record, so one order starts one session.
  - The command is the deployment's. A sandbox, a VM or `opencode serve` in a container all
    work. Fieldhouse's launcher is its own (FLDH), and Baton names no sandbox (R-BTN-107).

### 7. What the dashboard draws

- **Operator** (`repository/operator`, `/repositories/{repository}/operator`), for an operator's,
  owner's or administrator's session. It draws §4's list. Each row has:
  - **Work in my session**, which shows the `baton operator take` command and the line to give an
    agent that has `baton mcp operator`;
  - **Start a sandboxed session**, the `operator.order` action, drawn only where the entry is
    `orderable`.
- **Order** (`repository/orders/{order}`, `/repositories/{repository}/orders/{order}`). The page
  the order's reply links to. It draws the order's state as it moves.
  - Once joinable, it shows the session link as **Open session**.
  - It offers **Cancel** to the requester and owners.
  - It polls with the read's ETag (B-205).
- The overview strip and Needs you are unchanged. A sandboxed operator leg reaches Needs you
  through its `interact`.

## Security

- **New inputs and who writes them.**
  - **Operator entries:** an owner's key (`approvers.members`, R-BTN-188), never a push.
  - **Orders:** an operator principal; each is bounded per operator (one open order per ticket,
    five open in all) and expires.
  - **The claim's `order`:** a runner's hint, stored and gating nothing.
  - **Leg-scoped `requires`:** the ticket source, written by any pusher, as the unscoped clause
    already is.
- **Leg-scoped `requires` is a loosening.** Scoping `human-operator` to fewer legs loosens a
  requirement. A machine-key post that does so raises `baton.machine-post` as dropping a
  `requires` clause does
  ([checks and executors §5](checks-and-executors.md#5-grant-acceptance-span-and-registration-tokens-r-btn-146-r-btn-117-proposed)).
- **An operator key in an agent's reach.** It is a runner credential, `max_claims` 1 by default,
  on the repositories its owners granted. It never acts as an owner, trusted runner or human-only
  key. What a prompt injection gains from it is one runner's work on those repositories. That is
  the reach-3 exposure every runner key in an agent session already has. Each MCP session warns
  of it.
- **Session links carry a capability** (B-312). An order's link goes only to its requester, to
  owners' and administrators' sessions, to the reporting runner and to `interact` delivery. It is
  never logged or exported.
- **Baton launches nothing and holds no sandbox credential** (R-BTN-201, R-BTN-53). An order is a
  record and advice, not an outbox entry. The decision that kept launches out of Baton's outbox
  (R-BTN-201, Decisions) stands.
- **`human-operator` stays a statement** (values 12). The design adds who said it and why (the
  operator's name, the order) and checks neither.

## What it is not

- **Not a person leg.** A person leg is answered by a `std:decision@1` and no runner runs it
  ([R-BTN-116](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-4); B-116 works one in a
  person's own session). An operator leg is a runner leg that a person works, under a lease, with
  the course's evidence and checks.
- **Not an intervention.** An intervention is an agent a person starts on a Needs-you entry,
  holding a key that only tightens ([intervention sessions](intervention-sessions.md)). An
  operator leg is ordinary work on a course.
- **Not assignment.** Baton offers the operator work to every operator whose grant fits, and the
  person picks. Who a ticket is assigned to (B-36) may later filter the list. It never gates it.

## Decisions taken here

Each is a recommendation until B-327's review gate and the owner confirm it.

1. **Operator identity is a key, the email only a way to the dashboard.** This keeps values 7
   (SSH keys are identity) and every runner rule unchanged. *Rejected:* an Access email as the
   identity that holds the lease. It would need a second principal that claims and heartbeats.
2. **The person's own session is a local MCP server that is the runner.** Its process lifetime is
   the lease's liveness. It reads the course and the checkout, so the runner checks every move
   (R-BTN-106) and runs `close` and `handoff` (R-BTN-8) as for any leg. *Rejected:* the remote
   MCP endpoint holding a claim. Its calls are stateless, so the lease would need a long timeout
   that a closed session holds. It would also need Baton to run course code or trust an
   unchecked move (values 4).
3. **`OP` names the course's operator legs, not every leg.** *Rejected:* keeping every leg, which
   leaves an `OP` ticket's review to a person.
4. **The sandbox is an order a launcher serves.** *Rejected:* Baton starting sessions, which
   R-BTN-201's decision already rejected. *Rejected:* a Baton gate admitting `human-operator`
   only on an order's claim, which would make Baton check a capability (values 12).
5. **Operator runners claim only by name, by discipline.** *Rejected:* a grant flag that refuses
   unnamed claims. It would be a gate on what a runner has said it can do, and an operator key
   that takes the first operator ticket offered harms nothing.

## Open decisions

For the owner, each with the recommendation first:

1. **`operator_legs`' default**: (a) the course's start leg; (b) every leg, today's behaviour,
   with courses opting in to fewer.
2. **Order expiry**: (a) 15 minutes unclaimed; (b) an owner's setting per repository.
3. **The Fieldhouse half**: (a) a FLDH ticket for its launcher to serve orders and for the leg
   page to be the order's link, filed in Fieldhouse; (b) Baton's reference launcher only, for
   now.
4. **Assignment** (B-36): (a) a later filter on the list; (b) an order or take refused for a
   ticket assigned to someone else.

## Amends

[R-BTN-58](../BATON_SPEC/11-people.md#sec-11-2) (a grant's `operator` mark) ·
[R-BTN-155](../BATON_SPEC/11-people.md#sec-11-4) and
[people and dashboard §3](people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions) (the
`operator` role) · [R-BTN-129](../BATON_SPEC/11-people.md#sec-11-3) and R-BTN-127 (the actions
`owner.operator.add`, `owner.operator.remove`, `operator.work`, `operator.order`, `order.show` and
`order.cancel`; the `operator`, `mcp operator` and `launcher` CLI nouns) ·
[R-BTN-120](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-1)'s table row "the ticket's
posted `requires` clause (every leg)" · R-BTN-74 (the markdown source's `OP`) ·
[R-BTN-69](../BATON_SPEC/05-courses.md#sec-5-2) (`operator_legs`) ·
[R-BTN-100](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-7) (a claim's `order`) ·
[R-BTN-99](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-7) (`launch-candidates`' orders) ·
[R-BTN-201](../BATON_SPEC/08-runners.md#sec-8-3) and
[checks and executors §7](checks-and-executors.md#7-the-launcher-r-btn-201-proposed) (the hint's
`order`) · [R-BTN-113](../BATON_SPEC/08-runners.md#sec-8-3) (a new link reported at once) ·
[R-BTN-195](../BATON_SPEC/07-conditions.md#sec-7-1) (the runner raises `interact` for an order's
leg) · R-BTN-117 (`--operator` tokens) ·
[checks and executors §2.3 and §6](checks-and-executors.md#23-the-shipped-session-and-attached-executors)
(the `attached` executor and the ending verbs, built by B-330) · B-312 (the requester reads an
order's link) · §13 (`repository_operators`, `operator_orders`, `ticket_requires.leg`,
`claims.order_id`, `runners.operated_by`) · §14 (the routes) ·
[the vocabulary](../../docs/context/vocabulary.mdx) (operator, operator leg, order) ·
`tickets/HOW-TICKETS-WORK.md` (the `OP` line, written by `baton repo init`).

## Scenarios

Proposed; each takes the next free `S-BTN-n` in B-327.

| Scenario | Given | Then |
|---|---|---|
| an operator signs in | an owner adds an operator by token; `baton operator login --token` | a key at `op-<name>` with `human-operator` and `max_claims` 1; `operated_by` on its runner; a second use of the token refused |
| `OP` on its operator legs | an `OP` ticket on `create-pr` | `implement` requires `human-operator`; `review` does not, and an agent runner claims it |
| the operator work | three operator tickets: one ready, one held by a `baton.retries` hold, one depending on an open ticket | the read lists the first; `?blocked=1` adds the others with their blocks; a non-operator key is `forbidden` |
| taken in the person's session | `baton mcp operator`, `operator_take`, `leg_done` with a `reached` that is not an outcome, then a valid one | the first is refused on the channel and nothing reaches Baton; the second runs `close`, advances, and ends the claim suspended at the station, `review` then offered to agents |
| the session closes | stdin closed mid-leg | the claim ends `released:requested` with a hand-off within the drain's bound |
| an order gets its link | an order; a fixture launcher starts a runner whose executor names a link | the reply's `order_url` at once; `starting`, then `joinable` with `session_url` for the requester only; an `interact` condition with the same link |
| an order is taken or expires | an order; another runner claims the ticket; a second order with no launcher | the first closes `taken`; the second closes `expired` at 15 minutes; neither held the lease |
| an order cancelled | a claimed order cancelled by its requester | a `release` message; the claim ends `released:requested` with a hand-off |
