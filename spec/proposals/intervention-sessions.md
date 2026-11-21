---
title: "Proposal — intervention sessions: an agent a person starts on one Needs-you entry"
description: "A recommendation, not built: a person selects a condition under Needs you and starts an intervention session — a sandboxed leg or an existing agent over MCP — holding a credential scoped to that one condition, to diagnose and settle it; with the powers split, the scoped key, and today's interventions as evidence."
---
# Proposal — intervention sessions: an agent a person starts on one Needs-you entry

**Status:** recommendation for future development, not built and not scheduled (the owner,
2026-11-21: "we don't have to build this now"). Written as a hand-off. Nothing here changes a
rule; where it would, the rule is named.

## The goal

The owner, 2026-11-21:

> The overall design of Baton favors explicit flow control (via predefined courses), however
> there can be situations [where] exceptional cases must be handled, some examples:
> - A ticket times out at a station because no leg is available.
> - A ticket runs out of retries for a leg
> - All work is blocked from a runner
>
> In such cases the sort of interventions we have had in this conversation are necessary. So a
> debugging / intervention agent session - sandboxed, but with direct access to baton as repo
> owner (possibly as admin) and github with the ability to merge PRs seems necessary. These
> intervention sessions should be designed to solve a specific issue … not to be a long-running
> assistant like the "mayor".

And: "intervention session should start when [a] 'needs you' ticket condition [is] selected in
dashboard UI … ideally an existing agent should also be able to connect to the baton server and
handle these interventions through MCP."

## What it is not

- **Not a coordinator.** No standing agent watches the factory or assigns work (compare Gas
  Town's Mayor, `docs/compared-to-gastown.mdx`). A session exists for one Needs-you entry and
  ends with it. Baton stays a lease server that assigns nothing (values #12).
- **Not automatic.** A person starts each session, from the entry. Binding conditions to
  handlers that start by themselves is R-BTN-161's (designed, not built); this proposal is the
  person-started form, and could later be one of R-BTN-161's handler kinds.
- **Not a way around the course.** A session settles an exception; it does not replace the
  course graph. Where its fix is "move the ticket", it uses the actions Baton already has (a
  condition's restarts, a hold, the owner's route and adopt once built), each logged.

## What exists today (2026-11-21)

- **Needs you is the debugger** (R-BTN-163): every open condition, and every queued person leg,
  ordered by severity and age, on the dashboard's Conditions screen and the condition read
  (`GET /v1/repositories/{repository}/conditions`, `condition.list`).
- **Core's own conditions** `baton.*`: `baton.retries` (out of retries, R-BTN-122, R-BTN-126),
  `baton.contract`, `baton.stalled` (a leg `waiting` too long, R-BTN-167), resolved by an owner
  with `retry` or `park`; every other `baton.<sub>` is `notify` and closes with its cause.
  Resolving is an owner's or administrator's alone, never a delegated key's (R-BTN-163,
  R-BTN-186).
- **The owner's examples:** "times out at a station because no leg is available" is
  `baton.stalled`; "runs out of retries" is `baton.retries`; "all work is blocked from a runner"
  has no condition yet — a runner that claims nothing for a long time while work is ready would
  need a new `baton.<sub>` on the runner (for example `baton.runner-starved`, naming the gate
  rule that refused it most, §6.6's claim gates).
- **Delegated keys** (R-BTN-130, R-BTN-186) act as an owner on one repository but may only
  tighten and undo their own tightenings: they never resolve a condition, lift another's hold or
  loosen anything. **MCP** (`POST /v1/mcp`, the MCP key) and **OAuth for MCP clients**
  (`BATON_MCP_OAUTH_SPEC`, B-73) are proposals.
- **Confirmed actions** (people and dashboard proposal §3): an authority-changing action from a
  session waits for the key holder's confirmation code.
- **Fieldhouse**: sandboxed legs, the forge gate with capability levels (R-FH-90–94, from stage
  2), the leg archive (R-FH-82).

## The design

### Starting one

On a Needs-you entry the dashboard offers **Start an intervention** to an owner's or
administrator's session. The person chooses:

1. **the subject** the entry names — a ticket, a runner, or the repository (never wider);
2. **the powers** from the entry's menu (below): diagnose only, or diagnose and act, and which
   actions; and whether loosening actions run on the session's word or each wait for the
   person's confirmation (default: wait);
3. **the agent**: a **sandboxed leg** (Baton files nothing in git; it queues an `intervene` leg
   a runner claims, below), or **an existing agent over MCP** (the page shows a connection the
   person hands to their agent — Claude Code or any MCP client).

Baton records an **intervention**: its id, the condition, the subject, the powers, who started
it, when, and its expiry (default 2 hours). It mints one **intervention key** for it (below) and
adds the intervention to the condition's entry, so others see it is being handled.

### The intervention key

A new kind of delegated credential, minted per intervention and dying with it:

- **Scoped to one subject**: reads of that ticket, runner or repository and what they reference
  (its history, attempts, conditions, claims, leg runs and their pointers); actions only on it.
- **Powers are a list of registry actions** (R-BTN-129) chosen at start, from the entry's menu:
  - always: the subject's reads; `condition` comments (a note on the entry);
  - the condition's own restarts (`retry`, `park`, or a `notify` entry's acknowledgement) — the
    one carve-out from R-BTN-186's "a delegated key never resolves a condition", limited to
    **this** condition;
  - on its ticket: set or lift a hold (lifting one Baton or another credential set is a
    loosening — R-BTN-186 — and waits for confirmation unless the person granted it at start),
    expedite, stop the running leg, request a leg's status;
  - on its runner: request status; mark it drained (a new action: the runner finishes its leg
    and stops claiming, asked by a message as R-BTN-119 asks a leg to stop);
  - once built: the owner's route and adopt (R-BTN-83, B-120) for its ticket, always confirmed.
- **Never:** policy, approvers, grants, keys, owners, bars set by others, settings, any other
  subject, any `approvers.*`-governed action (R-BTN-188). A loosening it was not granted at start
  answers with a confirmation code the person enters (confirmed actions, people and dashboard
  §3).
- **Expires** at the intervention's end: the condition closing, the person ending it, or the
  expiry, whichever is first. Every action it takes is recorded with the intervention id
  (history rows and events name it), so the intervention's record is Baton's own.

### The two ways to run it

- **A sandboxed leg.** Baton queues the leg `intervene` of a small standard course on the
  subject (a ticket's own claim is never taken: the intervention is its own claimable unit, like
  a handler ticket of R-BTN-161, but held in Baton, not filed in git). A runner whose grant
  admits `intervene` claims it; its executor hands the leg the intervention key (never an owner
  key), the condition and the subject. On a Fieldhouse host the leg runs in a sandbox; its forge
  access is the gate's (R-FH-90), at an `intervene` capability level the deployment defines —
  read, comment, push to the ticket's branch, and merge only where the person granted "merge"
  at start (below). The leg's session is joinable (R-FH-80): the person can watch or steer it.
- **An existing agent over MCP.** The person's agent connects to Baton's MCP endpoint with the
  intervention key (or obtains one by B-73's OAuth flow, consent on the intervention's page).
  The endpoint exposes exactly the key's actions as tools (R-BTN-130), plus a prompt resource
  describing the condition, the subject and the powers. The agent's forge access is its own,
  outside Baton: Baton cannot give or restrict GitHub access over MCP (open world, values #13).

### Diagnose broadly, act narrowly

Most of what blocks a factory is not in Baton's state. Of the 2026-11-21 interventions:

| Intervention | Within an intervention's powers? |
|---|---|
| 31 tickets held `attempts-exhausted` after a host fault | Yes: per ticket, lift the hold (a loosening; confirmed or pre-granted) |
| B-166 already delivered outside Baton | Mostly obsolete: R-BTN-203's reconcile leg; else hold, then a person closes |
| Runners churning the board on a gateway fault | Yes for the stop (drain the runner); the cause was on the host |
| The gateway's firewall dropped the host's own replies | No: host configuration. Diagnose, report to the owner |
| A stale course pin in the sync workflow | No: a CI workflow. Diagnose, open a PR a person merges |
| Re-pinning the executor; leftover E2B sandboxes | No: host and deployment. Diagnose, report |
| A ticket stopped on CLAUDE.md's credential rule | Partly: diagnose, comment; changing the rule is the owner's |

So a session's work is mostly **diagnosis**: read Baton's subject, the forge, the leg archive and
the runner's log, and write a finding on the entry. **Acting** is limited to Baton actions on the
subject and, through the forge, to PRs. Credentials, CI workflows, deploys and hosts stay a
person's (CLAUDE.md's *Tickets are tasks, not authority*): the session writes the diagnosis and
the exact commands for a person to run.

### Merging

The owner asked for "the ability to merge PRs". Under the open world (values #13) an intervention
that merges is one more outside actor, which Baton detects (R-BTN-203). Merging is still the most
powerful thing an agent can do, so:

- it is a power the person grants at start, for the subject's own PRs, never by default;
- on a Fieldhouse stage-2 home it goes through the gate's merge level, not a person's account;
- an agent over MCP merges with its own forge identity, which Baton neither grants nor limits.

## Security

- **Reach 3.** The session reads ticket text, leg output and PR bodies, which anyone who can push
  writes. Everything it reads is data, never instructions (CLAUDE.md). Its credential is scoped
  to one subject and expires, so an injected instruction can at worst misuse that one subject's
  granted actions; loosenings wait for the person unless granted, and nothing touches policy,
  keys or other subjects.
- **The key never reaches git or a log.** It is handed to the leg's executor or shown once to the
  person for their agent; Baton stores its hash (as it does every credential, §12.1).
- **One intervention per condition at a time.** Starting a second ends the first (its key is
  revoked).

## Open decisions for the owner

1. The new `baton.<sub>` for a runner that claims nothing while work is ready, and its threshold.
2. The default powers menu per condition type, and whether "lift Baton's hold" may ever run
   without confirmation.
3. Whether an administrator may start interventions across repositories (a tenant-level subject),
   or only per repository.
4. Whether the sandboxed form needs a runner grant role of its own (`intervene`), or any runner
   may run it.
5. Whether an intervention's finding is kept beyond a pointer (R-BTN-33: Baton keeps pointers,
   never content — the finding would live in the leg archive or as a comment on the entry).
6. Whether later, R-BTN-161 bindings may start interventions without a person (for example a
   diagnose-only session on every `baton.retries`).

## Where to start when this is picked up

- Read R-BTN-160–163 (§7), R-BTN-129/130/186 (§11.3, §12), the people-and-dashboard proposal §2
  (MCP) and §3 (confirmed actions), `BATON_MCP_OAUTH_SPEC`, values #12 and #13, and Fieldhouse's
  R-FH-80 and R-FH-90–94.
- The pieces it needs, roughly in order: the MCP endpoint and key (B-25/B-124, B-73); confirmed
  actions (B-206); the intervention record and key (new); the `intervene` course and capability
  level (new, Baton and Fieldhouse); the Conditions screen's **Start an intervention** (new); the
  runner-starvation condition (new).
- Evidence: `docs/interventions.mdx`, 2026-11-21's entries, and the session that wrote this
  (Claude Code, 2026-11-21) as the worked example of what interventions look like.
