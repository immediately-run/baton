---
title: "Baton — the work's live state, off git"
description: "BATON_SPEC's front: its title, status, companions and contents."
status: proposal
updated: 2026-11-19
---

# Baton — the work's live state, off git

**Status:** proposal — Baton's specification as it stands. How it got here — dated
amendments, rationale, retired requirement ids and the map from the old section numbers — is
in [`spec/BATON_SPEC_HISTORY.md`](../BATON_SPEC_HISTORY.md).

**Updated:** 2026-11-19

> **Companions.** History: `spec/BATON_SPEC_HISTORY.md`. Designs not yet built:
> `spec/proposals/`. Where this spec names a deployment or a repository, it is an example, not
> core. Tickets cited as `R3-n` and `B-n` are in [`tickets/`](../../tickets/). Requirement ids
> `R-BTN-n`, scenario ids `S-BTN-n` and gate ids `G-BTN-n` are stable: code, tests and the
> Quint model cite them.

> **Terminology: arena.** The unit Baton coordinates — one ticket source, its configuration and
> everything Baton owns about its tickets — is an **arena** in the
> [vocabulary](../../docs/context/vocabulary.mdx). This spec still writes it a **registered
> repository**, and a ticket's arena its **home** (§3); the CLI's chosen one is "the home in
> force". Where the spec names a registered repository's or a home's path, forge, host, commits,
> branches, files or checkout, it means the arena's **config repository**, the git repository its
> `.baton/` lives in; a code repository it names as one. The rename of these words comes in
> stages, with the old names accepted meanwhile.

## Contents

| § | Title | What it settles |
|---|---|---|
| 1 | What Baton is | the ledger and the cache, what Baton owns; the core's vocabulary; no repository code |
| 2 | Deployments: tenants, hosts and the service | one Durable Object per tenant, the alarm, the two hosts, tenancy, capacity and admission |
| 3 | Repositories and forges | registration, forges and their ids, sync credentials, wants and notifications |
| 4 | Tickets, syncs and the board | ticket sources, the board post, observations, snapshots, discrepancies, child tickets |
| 5 | Courses | the course file, stations and legs, positions, contracts, sources, capabilities as the runner's statement |
| 6 | Prerequisites, blocks and advice | blocks, resources and readings, matching rules, expedite and hold, messages, how a leg runs, capacity |
| 7 | Conditions | conditions, handlers and restarts, retries, deadlines, the outbox |
| 8 | Runners | identity, heartbeats, the runner and its legs, registration, streaming, the doorbell |
| 9 | Claims | the fenced lease, advancing, ending, reaping, confirming, attempts, activities |
| 10 | Checks | check courses and the merge check's delivery |
| 11 | People: administrators, owners and their surfaces | administration, grants, the CLI, MCP, sign-in, the dashboard |
| 12 | Security | principals, signatures, untrusted text, same-site, hardening, the core guarantee |
| 13 | Data model | the current schema |
| 14 | API | every route |
| 15 | Verification: the model, the harness, scenarios and gates | the Quint model, integration and load tests, every scenario and gate |
| 16 | Adoption (an appendix) | cutover and the git mirror: legacy, removed with its code |
| — | Decisions | each decision still in force, one line |
| — | Open questions | what is not yet settled |
| — | Load-bearing assumptions | what `check:spec` checks |

