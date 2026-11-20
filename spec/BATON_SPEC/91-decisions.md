---
title: "Decisions"
description: "One line per decision in force; the reasoning and the rejected alternatives in full are in BATON_SPEC_HISTORY.md (Decisions in full)."
---
## Decisions

One line per decision in force; the reasoning and the rejected alternatives in full are in
`BATON_SPEC_HISTORY.md` (Decisions in full).

**Scope and truth**

- Chose Baton as the only lock and the only counter, and git as the record of the work alone; the git-based mechanisms that exist are legacy (R-BTN-193, R-BTN-4, R-BTN-74).
- Chose standard courses that assume no particular deployment, a factory keeping its own security and quality-assurance courses (R-BTN-131).
- Chose a protected default branch that only a deterministic merge runner and humans update, over a git proxy, per-worker forks or verified signatures (R-BTN-180, R-BTN-182, R-BTN-183).
- Chose to keep Baton cooperative on one trusted machine and leave enforcement to the deployment (R-BTN-180).
- Chose that courses and leg logic change by a human's push or merge, and that tickets land only with a human approval (R-BTN-184).
- Chose human-only credentials for every human gate, used for nothing else and kept from agent sessions; `human-gates` is claimed only where `human_key` is `hardware` (R-BTN-185, R-BTN-189).
- Chose two forge identities, a human-only one that administers protected repositories and an everyday one for the owner's agent sessions (R-BTN-185's `human_identity`; keeping the two apart is the deployment's, §12.8).
- Chose authority by credential, not channel: a delegated key may tighten and undo its own tightenings, and only loosening a limit needs a human (R-BTN-186).
- Chose to run a sourced course's code from its source, the home referring to Baton's legs rather than copying them (R-BTN-134).
- Chose that a claim's branch appends its leg's progress to its own ticket's `## Status` section without a human approval (R-BTN-184).
- Chose attestations, typed facts a trusted writer makes, as a kind of leg prerequisite, bound by subject and authenticated by the request that posts them (R-BTN-181).
- Chose continuity, one unbroken chain of attested commit ranges, as the whole of authorship, with no signed authorship (R-BTN-183).
- Chose that a domain that runs a branch's code is one of its writers, so reviewers read the change and never run it (R-BTN-183).
- Chose to state each guarantee separately, as a condition over the policy, and let the repository choose (§12.8).
- Chose a grant's role and a domain label as the whole of a grant's trust, over a separate trust level, a model family or a separate-domain guarantee (R-BTN-180, R-BTN-183).
- Chose to state that review is no security gate, `independent-review` requiring two reviews from distinct domains and nothing about model families (R-BTN-183, R-BTN-189).
- Chose trusted runners that hold the only credential for a sensitive leg's action, re-check its attestations against Baton's record and trust Baton (R-BTN-182, R-BTN-189).
- Chose that ticket `tier` is not a protected input, while no runner above the VM level serves a repository that runners below it push (R-BTN-184).
- Chose provenance alone, each ticket served with who last pushed its body, over a `control-changed` notice (R-BTN-194, R-BTN-66).
- Chose to verify no commit signature anywhere: who may land a path is the policy's, and who wrote one is the forge's pusher record (R-BTN-66, R-BTN-133, R-BTN-194, R-BTN-107).
- Chose to make a break-glass change visible as an `out-of-course` finding, refusing nothing, and only where the policy protects control paths (§12.9).
- Chose the policy knob `repos.unlisted` over one rule for every repository: a `cooperative` home resolves `repos:` by name, a `protected` one reaches only its list (R-BTN-140, R-BTN-188).
- Chose to run checks only on the repository's own branches over a sandbox for forks' code (R-BTN-114).
- Chose to answer a `baton.*` condition only through Baton's own authenticated surfaces, never a delegated key, and to count from Baton's own traversal record (R-BTN-163, R-BTN-63).
- Chose no core default timers per tier: timers are the course's (R-BTN-167).
- Chose to keep dependencies within one repository (R-BTN-120).
- Chose to leave reviewer-independence seats and tags as cooperative checks (R-BTN-60, R-BTN-66).
- Chose a Cloudflare Durable Object over SQLite on a home server (§2).
- Chose one codebase with Cloudflare in production and a Node host for development and self-hosting over separate implementations (R-BTN-55, R-BTN-56).
- Chose the ticket source as the home of a ticket's content and closure, git as the home of the work's evidence, and Baton as the one authority on the lease, positions, attestations and owner state (R-BTN-74, R-BTN-33, R-BTN-35, R-BTN-39).
- Chose a ticket that is a course of legs and can suspend at a station over one lease for its whole life (R-BTN-39).
- Chose legs stateless at their boundaries over a lease per leg with affinity (R-BTN-44).
- Chose a claim that goes stale only when git takes the ticket away over "stale when the leg is no longer ready" (R-BTN-35).
- Chose commit ancestry and Baton's own observation numbers over commit timestamps to order snapshots (R-BTN-10, R-BTN-62).
- Chose to log every disagreement with git and adopt git's value; what Baton owns is never in a discrepancy (R-BTN-85, R-BTN-39).

**Baton and courses**

- Chose a minimal core that acts only on its own vocabulary, with course logic in each home repository, over core interpreting courses (R-BTN-50).
- Chose Baton as an advisor that gates only correctness and the owner's explicit say, over a gatekeeper of capacity (R-BTN-45, R-BTN-178).
- Chose that Baton runs no repository code and runners rank, over hooks sandboxed in Baton or hosted (R-BTN-98).
- Chose provider usage, forecasts and model advice as course logic, sharing only measured readings and the claims' own reports (R-BTN-60, R-BTN-100, R-BTN-101, R-BTN-178).
- Chose cooperative gates over signed commits, a required lease check or per-runner forge identities (R-BTN-46, R-BTN-66).
- Chose to keep what agents must not change as Baton settings set by owner and administrator keys, over an owner-only file in git (R-BTN-66, R-BTN-67).
- Chose owner and required bars that name a course (or `*`) over per-repository bars (R-BTN-67).
- Chose one validated `course.json` per course, a closed graph Baton validates but never interprets, over vouches, guards or YAML (R-BTN-69, R-BTN-70).
- Chose a `version` per course, with `min_runner_version` and a test kit, over a fleet-wide skills version (R-BTN-22, R-BTN-65).
- Chose a runner that runs one script per leg in a worktree at the claim's commit over one per-course runner module (R-BTN-72, R-BTN-133).
- Chose one runner per checkout serving every course it declares over one runner and one clone per course (R-BTN-72).
- Chose a leg that names the station it reached and the leg it queues over inferring the next leg (R-BTN-81, R-BTN-83).
- Chose pointers and digests of leg inputs and outputs, validated by the runner, over Baton storing or validating content (R-BTN-82, R-BTN-84).
- Chose validation against a schema and its base, with a conservative static refinement check, over full JSON Schema (R-BTN-108).
- Chose entry requirements on stations over requirements on legs (R-BTN-109).
- Chose a shared `std:` schema library over formats defined in core (R-BTN-110).
- Chose declarative views Baton renders over course-shipped rendering code (R-BTN-112).
- Chose capability types declared in each course file, checked by the runner, over a vocabulary in core (R-BTN-121).
- Chose replaceable per-repository ticket sources, with default sources in the CLI, over a ticket format in core (R-BTN-74).
- Chose a course pinned to a source commit reachable from its default branch, `sync.mjs` trusted as a pinned action is; the CLI ships no course (R-BTN-134).
- Chose a read-only worktree per commit, installed from the course directory or `.baton/` and cached by lockfile digest, over bundling, the home working tree or loaders (R-BTN-133).
- Chose planning as an ordinary course (`epic`), and no merge queue, steps inside a leg, federation or agents supervising agents (R-BTN-124).

**Tickets, time and parallelism**

- Chose child tickets as the only parallelism over several positions in one ticket (R-BTN-4, R-BTN-86, R-BTN-165).
- Chose one active claim per ticket and several per runner, each in a clone of its own under the runner's one lease, over one claim per runner and over lanes (R-BTN-4, R-BTN-58, R-BTN-72).
- Chose a runner-declared lease timeout over a per-claim duration (R-BTN-9).
- Chose sidecar heartbeats with fencing over heartbeats from the agent thread (R-BTN-6, R-BTN-7, R-BTN-19).
- Chose reaping (the alarm for a silent runner, a force-reap for a hung one) over a release message to a dead runner (R-BTN-19).
- Chose `confirmed_at` over a `settled` claim status (R-BTN-10).
- Chose expedite as a property of the ticket over a message (R-BTN-12).
- Chose typed, timed activities over a free-text stage (R-BTN-24).
- Chose transcript pointers reported by archivers over paths derived by convention (R-BTN-20).
- Chose a closed world, a ticket claimable only after a post names it, over open-world claims settled by a later post (R-BTN-5, R-BTN-73, R-BTN-105).
- Chose stored, indexed block rows and an `unblocked` event over computing blocks on read or re-deriving dependencies (R-BTN-75, R-BTN-77).
- Chose one way to ask a person, a person's leg answered by a `std:decision@1`, over posted decisions as a block kind, light questions and choice stations (R-BTN-116, R-BTN-161).
- Chose readings posted by instruments that lapse to `unknown` and fail open over Baton running checks (R-BTN-76, R-BTN-101).
- Chose runners seeing their peers' claims and shared account readings per Baton over per-repository isolation of capacity data (R-BTN-99, R-BTN-101).
- Chose first come, first served for an account's room over weighting it by repository (R-BTN-61).
- Chose to merge repositories by `weight` and courses by place in their own order over comparing scores across courses (R-BTN-61).
- Chose `max_queue` as a warning that closes a course's intake as advice over a refusing bound, which could deadlock a loop (R-BTN-79).
- Chose a blocked edge (`released:blocked`, no attempt spent) over a `blocked` station or treating capacity as an error (R-BTN-126).
- Chose a leg's capability block as a request the runner confirms with that capability's own check, run outside the leg, over trusting the leg's report (R-BTN-126, R-BTN-121, R-BTN-76).
- Chose one `requires` per leg, stored as blocks and answered by `baton leg why`, with one primitive per kind of prerequisite (R-BTN-120, R-BTN-132).
- Chose `not_before` written to git, schedules in leg scripts and recurring jobs as series of child tickets; a duration Baton measures is a timer (R-BTN-89, R-BTN-167).
- Chose, under `cooperative`, to carry no mechanism whose only purpose is to catch a pusher going round Baton's record; under `protected` that record is a boundary (R-BTN-39, R-BTN-46, R-BTN-66).
- Chose the course file to travel with every sync over a hash with the body only on change (R-BTN-69).
- Chose owner state exported and imported, not mirrored to git, where agents could change it (R-BTN-88).
- Chose one Baton per team at a stated, load-tested envelope over sharding (R-BTN-87).
- Chose `position-disagrees` listed on the Sync screen only and fired on every posted `available` past the start, read from `display.status` (R-BTN-85, R-BTN-33).
- Chose a resume record's `branches` and `prs` read by core for the history read, over serving the records whole for the CLI to prune (R-BTN-50, R-BTN-24).
- Chose to prune a purged ticket's claims, legs and activities with the ticket's retention over keeping every claim forever (R-BTN-149).
- Chose to test a live runner by one indexed range over its lease, never a read of every session (R-BTN-9, R-BTN-3).
- Chose a ticket source made of a reader and an optional, declared writer over one module mixing both directions (R-BTN-74).

**Conditions, calls, deadlines and cancellation**

- Chose conditions that the repository binds to handler courses over delivery policy in core or handler ids in each course (R-BTN-160, R-BTN-161, R-BTN-163).
- Chose bindings held in git with no owner setting (R-BTN-161).
- Chose a short wait in the claim, then a suspension, over always suspending or holding the claim until an answer (R-BTN-162).
- Chose to resume a withdrawn handler's leg with the default restart (R-BTN-162).
- Chose to refuse a post that does not descend from the head and to adopt a rewritten default branch only by an administrator's forced Resync, over held snapshots (R-BTN-11, R-BTN-147; the forced Resync is proposed, [tickets and sources](../proposals/tickets-and-sources.md), and until it is built such a post is held for the owner).
- Chose a course's ordinary `cancel` leg over compensation legs run in reverse path order (R-BTN-168).
- Chose retries as the built-in default handler of `error` over a retry course (R-BTN-122).
- Chose per-leg retry policies bounded by the owners' default, ceiling and floor, a backoff being a prerequisite, over per-repository policies (R-BTN-122).
- Chose a deadline enforced by a release and then a fence, a timeout being a failed attempt, over stopping a runner from Baton (R-BTN-90, R-BTN-167).
- Chose one outbox for git writes, check runs and ticket-store writes, delivered by runners the policy admits by role, over a git credential in Baton or a courier key role (R-BTN-171, R-BTN-115).
- Chose that Baton holds the GitHub App key and the forge trigger tokens and dispatches workflows itself, over a dispatch courier and signed entries (R-BTN-94, R-BTN-171, §12.7).
- Chose readings as attestations about a resource instance, authenticated by the request that posts them, gate or advice being the requirement's choice (R-BTN-181, R-BTN-76, R-BTN-188).
- Chose two resource scopes, `service` and `account`, over `runner` and `host` scopes and an administrator's overriding reading (R-BTN-76, R-BTN-40).
- Chose one versioned policy document per repository, whose knobs presets fill, over landing modes Baton hard-codes (R-BTN-188).
- Chose guarantees as named conditions over the policy, each including the guarantees it rests on, enforced through the policy's own `floors` list (R-BTN-189).
- Chose whose attestations count, and the merge criteria, as policy over course files (R-BTN-181, R-BTN-188).
- Chose a separate protection checker, a trusted runner that merges nothing, over the merge runner holding a credential that can rewrite rulesets (R-BTN-180).
- Chose to leave `refs/baton/*` outside every guarantee and to read nothing from it that a trusted leg acts on (R-BTN-180).
- Chose a `plain-git` preset, the `cooperative` values without what needs a forge, as a new `git` repository's default (R-BTN-188).
- Chose leg state in the forge's PR conversation where there is a forge and on a per-ticket side branch where there is none, with no knob (R-BTN-190).
- Chose one approver list in the policy, `approvers.policy`, for every policy change, over classifying each change as a tightening or a loosening (R-BTN-188).
- Chose that Baton stops a repository whose floored guarantee breaks, over runners that refuse to claim when told so (R-BTN-189).
- Chose to keep deployment duties Baton cannot observe out of the policy and out of Baton's guarantees (§12.8).
- Chose three sources of a queued leg, one retry policy under the owners' ceiling and floor, and two clocks on a leg with a person leg's `expires` (R-BTN-83, R-BTN-122, R-BTN-167, R-BTN-90).
- Not adopted: BPMN tokens and parallel gateways inside one ticket, BPMN as a file format or engine, and Lisp dynamic variables beyond condition bindings (R-BTN-160–R-BTN-168).

**Runners, people and surfaces**

- Chose a scheduling version that telemetry does not move, a per-runner in-memory memo of "nothing eligible" bounded by a clock deadline, indexed matching sets and one rebuildable candidate projection, over a runner-by-ticket eligibility matrix or stored dashboard copies (R-BTN-196, R-BTN-61).
- Chose sessions that report moves to their runner over sessions holding a claim credential (R-BTN-106).
- Chose one executor seam, a versioned module the runner's host picks, over a closed list of isolation modes or a repository-selected hook (R-BTN-107).
- Chose a check leg's withheld credentials as the capability `checks:withheld-credentials`, which only an executor's `provides` can declare (R-BTN-114, R-BTN-121, R-BTN-107).
- Chose a leg's agent command as the first present of the home's per-leg setting, the course's per-leg `agent_command`, the home's top-level `agent_command` and the `--harness` fill (R-BTN-131).
- Chose a runner that refreshes a filling session under the same claim over losing the lease (R-BTN-123).
- Chose stopping a leg through the authenticated release path over control from a viewer's stream (R-BTN-119).
- Chose a noun-verb CLI renamed outright over aliases, in one tree whose help is generated from the registry's command table (R-BTN-127).
- Chose each leg run's output as create-only chunks in an owners' bucket or local directory, over a git transcript repository or relaying through Baton (R-BTN-128).
- Chose one action registry from which REST, the CLI, the dashboard and the MCP endpoint derive, an MCP key being a delegated key marked per action (R-BTN-129, R-BTN-130, R-BTN-186).
- Chose a leg that waits on an effect git or the forge shows over waiting on "sent" (R-BTN-116).
- Chose check courses whose verdict is a command's exit status, the forge's own check runs being enough for `merge.checks: required` (R-BTN-114, R-BTN-153, R-BTN-183).
- Chose either an SSH key or an API key for every administrator, owner and runner, over one kind per role (R-BTN-13, R-BTN-159).
- Chose administrator keys anchored in the deployment's secret and owner and runner keys in SQLite behind a signed API, over keys in git or Cloudflare Access as identity (R-BTN-57).
- Chose dashboard sessions as one `session` principal carrying its key's role, scoped to what that key still owns, over an administrator-only dashboard (R-BTN-155, R-BTN-129).
- Chose to keep a ticket's holds, cancel, attempts and backoff when it leaves the board and to restore them if its id returns (R-BTN-12).
- Chose capabilities on each repository's grant over capabilities on the key (R-BTN-58).
- Chose one machine key that may work, sync and report readings, syncing only where a grant opts in, over one role per machine key (R-BTN-102, R-BTN-146).
- Chose a pulled sync (Baton records a want; any runner pulls it) and a sync key usable on any forge over forge dispatch alone or a stored bearer secret (R-BTN-93, R-BTN-94).
- Chose forge webhooks that only trigger a sync over stations built from payloads (R-BTN-73).
- Chose a merge's `pull_request` delivery and the alarm to dispatch a repository's sync, over the forge's schedule alone (R-BTN-73).
- Chose a passive plain git server, synced by runners (R-BTN-105).
- Chose a hibernating WebSocket doorbell over server-sent events or push delivery: the heartbeat stays the one delivery and fence path (R-BTN-91).
- Chose one tenant per Baton, named by its origin, with a router for many tenants later, over a tenant id on the wire or a shared object (R-BTN-135–R-BTN-138).
- Chose loopback binding by default for the local host, TLS being the operator's (R-BTN-158).
- Chose GitLab Developer (30) as the role that can push (R-BTN-139).
- Chose `pusher` as the one word for a forge author whose words count, `trusted` being the runner role's (R-BTN-139, R-BTN-192).
- Chose a Quint model checked on the author's machine and against every scenario's trace over hosted CI or tests alone (R-BTN-68).
- Chose driven, fake-clock integration scenarios in every behaviour change over unit tests alone (R-BTN-29–R-BTN-31).
- Chose capabilities matched by name, a runner deciding what its keys and tools amount to, over a capability ontology and route choices evaluated in core (R-BTN-174, R-BTN-98).
- Chose a capacity on a capability, its seats stored when a leg starts, over seats on resource instances and a `host` resource scope (R-BTN-178, R-BTN-121).
- Chose to drop the owner settings `required_independence`, `trigger_workflows` and `report_horizon_h` and to keep those that differ between deployments (R-BTN-66).
- Chose `human-operator` as a runner's own statement, admitted by grants like any capability, over an administrator-only grant (R-BTN-121, R-BTN-58).
- Chose to skip an owner key an administrator revoked when the seed names it, over stopping the start (R-BTN-47).
- Chose the CLI's reads to return the dashboard's own queries behind the signed principal over a second read model (R-BTN-1, R-BTN-179).
- Chose one ticket, one PR, one merge for every standard course that writes work, a course needing several approvals being several tickets (R-BTN-131).
- Chose git facts to move a ticket only on legs that declare it and only by an edge from Baton's station, over git replaying positions (R-BTN-35, R-BTN-39, R-BTN-10).
- Chose every statement Baton receives about the work to be an attestation whose writer the policy admits per type, the sync being the writer `sync` (R-BTN-191).
- Chose four nouns for what crosses Baton's boundary (attestations, commands, outbox entries and replies) over one noun per direction (R-BTN-191, R-BTN-94).
- Chose, under a policy admitting no `sync` arrival, a fact reader, the merge runner reading a closed set of forge facts, over an owner's confirmation per human action (R-BTN-192).
- Chose to mask every kept variable whose name looks like a credential's, besides those the runner knows and those `mask_env` lists, over a list alone (R-BTN-144).
- Chose an administrator's confirmed fence clear over bounding `fence_deadline` (R-BTN-19).
- Chose `baton ticket request` to decide between a push and a PR by the forge's answer, on a side branch outside every `branch_pattern` (R-BTN-131, R-BTN-180).
- Chose `timed_out`, and no `neutral` at all, for a check command's timeout or `exec` error (R-BTN-114, R-BTN-153).
- Chose a two-step sign-in bind, the code's row previewed before an explicit yes, over one call that binds at once (R-BTN-155).
- Chose a final retirement that ends everything scoped to the repository and never re-registers its id, over a reversible flag (R-BTN-47).
- Chose process guards in the ticket commands and checks over reviewers catching the same faults round by round (R-BTN-74, R-BTN-31).
- Chose migration and scenario numbers taken as the next free one at merge over a ledger of reservations in git (R-BTN-31, §13).
- Chose to run a trusted leg's override through the runner's executor, the deployment keeping it from the trusted runner's credential, over Baton sandboxing it (R-BTN-182, §12.8).
- Chose the dashboard as a walk down the entity tree, one entity per screen, its controls the registry actions `ui.view` places there, over standalone console screens (R-BTN-129, §11.4).
- Chose React and TypeScript with a build step, one bundle loading nothing from another origin, over a dependency-free dashboard (§12.3, §11.4).
- Chose a session's controls narrower than the CLI's: the tenant screens read-only, `ticket.route` and `ticket.adopt` the CLI's, Stop one click (R-BTN-155, R-BTN-83, R-BTN-39, §11.4).
- Chose `baton ticket new` PR-first, the filing branch asked of the forge before any push to the default branch, `--direct` keeping the push (R-BTN-74, R-BTN-199).
- Chose a person joining the leg's own agent session, asked by an `interact` condition, over pausing or answering such requests in Baton (R-BTN-195, R-BTN-69, R-BTN-107).
- Chose a floor and a recommendation of client versions, stated on every response, over a single required version or an auto-updating CLI (R-BTN-197).
- Chose to keep a failed leg's last output, shown and never read, over keeping nothing or parsing it to choose the end (R-BTN-131, §9.4).
- Chose leg events, typed events Baton tells a running leg, over reusing conditions for the inbound direction or letting every edit end the claim (R-BTN-198, R-BTN-35, R-BTN-119).
- Chose a launcher outside Baton that ranks `launch-candidates` and starts sessions by its host's own means, over launches queued in Baton's outbox (R-BTN-201, R-BTN-45, R-BTN-98, R-BTN-107).
- Chose a runner-side queue of the host user's orders, run without a claim only while Baton is unreachable and reported through an ordinary claim on its return, over a git lock beside it or runners idle through an outage (R-BTN-202, R-BTN-193, R-BTN-72).
- Chose proposal pages for unbuilt designs, the course's own pages for a shipped course's contract, and this specification for the reference runner and the CLI ([the simplification review](../../docs/review/spec-simplification-review-2026-11-19.mdx)).
