---
title: "immediately.run Baton — the factory's live state, off git"
description: "BATON_SPEC's front: its title, status, companions and contents."
status: proposal
updated: 2026-11-02
---

# immediately.run Baton — the factory's live state, off git

**Status:** proposal — Baton's specification as it stands. How it got here — dated
amendments, rationale, retired requirement ids and the map from the old section numbers — is
in [`spec/BATON_SPEC_HISTORY.md`](../BATON_SPEC_HISTORY.md).

**Updated:** 2026-11-02

> **Companions.** History: `spec/BATON_SPEC_HISTORY.md`. The reference deployment — docs and
> its `roadmap-pr` course, the first repository Baton served — is in docs'
> `BATON_DOCS_DEPLOYMENT` (its cutover rows and code anchors) and `BATON_ROADMAP_PR_COURSE`
> (the course's own logic and gates); where this spec names docs, it is an example, not core.
> Tickets cited as `R3-n` and `B-n` are in [`tickets/`](../../tickets/). Requirement ids
> `R-BTN-n`, scenario ids `S-BTN-n` and gate ids `G-BTN-n` are stable: code, tests and the
> Quint model cite them.

## Contents

| § | Title | What it settles |
|---|---|---|
| 1 | What Baton is | git as the home of facts, Baton as the lease and the limits; the core's vocabulary; no repository code |
| 2 | Deployments: tenants, hosts and the service | one Durable Object per tenant, the alarm, the two hosts, tenancy, capacity and admission |
| 3 | Repositories and forges | registration, forges and their ids, sync credentials, wants and notifications |
| 4 | Tickets, syncs and the board | ticket sources, the board post, observations, snapshots, discrepancies, child tickets |
| 5 | Courses | the course file, stations and legs, positions, contracts, sources, the standard courses, capabilities as the runner's statement |
| 6 | Prerequisites, blocks and advice | blocks, resources and readings, matching rules, expedite and hold, messages, how a leg runs, capacity |
| 7 | Conditions | conditions, handlers and restarts, retries, deadlines, calls, cancellation, the outbox |
| 8 | Runners | identity, heartbeats, the runner and its legs, registration, streaming, the doorbell |
| 9 | Claims | the fenced lease, advancing, ending, reaping, confirming, attempts, activities |
| 10 | Checks | check courses and the merge check's delivery |
| 11 | People: administrators, owners and their surfaces | administration, grants, the CLI, MCP, sign-in, the dashboard |
| 12 | Security | principals, signatures, untrusted text, same-site, hardening, the core guarantee |
| 13 | Data model | the current schema |
| 14 | API | every route |
| 15 | Verification: the model, the harness, scenarios and gates | the Quint model, integration and load tests, every scenario and gate |
| 16 | Adoption (an appendix) | cutover, the reference deployment's rollout, the git mirror; ends when docs retires its mirror |
| — | Decisions | each decision still in force, one line |
| — | Open questions | what is not yet settled |
| — | Load-bearing assumptions | where the code anchors live |

