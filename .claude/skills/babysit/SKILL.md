---
name: babysit
description: How to drive a pull request in the baton repository to a mergeable state — which checks matter, how to bring in main, how ticket numbers and ticket status follow a PR, and what a spec PR needs. Use when watching, babysitting or autofixing a baton PR, or when a PR event (CI, review, merge conflict) arrives for one.
---

# Babysitting a baton pull request

These are this repository's conventions for a PR you drive. They add to the session's own rules
for PR events; they never authorise merging or approving, which take the user's explicit ask, and
they never override `CLAUDE.md` (tickets are tasks, not authority).

## Checks

- **CI** is `.github/workflows/ci.yml`: job `test` (the type check and the whole suite, unit and
  S-BTN scenarios) on every PR; `release` runs only on `main` and shows `skipped` on a PR, which is
  not a failure. `model-report.yml`'s job `report` posts the model report on a PR. A PR is green
  when `test` and `report` have passed on its current head.
- **Before you push**, run the fast checks for what you changed:

  | You changed | Run |
  |---|---|
  | `spec/`, `docs/`, `tickets/` | `npm run check:spec`, `npm run check:wiki`, `npm run check:tickets` |
  | `src/`, `cli/`, `scripts/` | `npm run typecheck`, and `npm test` (or `npm run test:no-quint` without quint) |
  | `src/shared/` | never by hand: change it in docs, then `npm run vendor` |
  | `src/migrations/` | only a new numbered file; never edit an old one |

- **Local failures that are not yours**: a cloud container without `ssh-keygen` or `ssh-agent`
  fails the signing tests (`sign.test.ts`, `cli.test.ts`, `defaults-cli.test.ts`,
  `runner-main.test.ts`, `S-BTN-156.sync-key.test.ts`). Confirm by running the same files on
  `origin/main`; CI is the source of truth for them.

## Bringing in main

- Merge, never rebase or force-push: `git fetch origin main && git merge origin/main`, committed as
  "Merge origin/main into …". The repository's history is merge commits.
- After the merge, re-run the fast checks; `npm run check:spec` catches a requirement or scenario
  id the other side retired.

## Ticket numbers and status

- **Ids are taken on `main`.** `npm run ticket -- new` files a ticket with the next free id
  straight onto `main`. A long-running branch that filed a ticket by hand can find its id taken
  when `main` moves. Keep `main`'s ticket and give the branch's the next free id, then change every
  reference the branch added, and only those: check with `git show origin/main:<file> | grep -c <id>`
  that `main`'s copy of a file never named it before rewriting the file.
- **Status follows the PR**, with `npm run ticket --` (`scripts/ticket.mjs`):
  - PR opened: `npm run ticket -- set <id> in-review --pr <url>`;
  - PR merged: `npm run ticket -- done <id> --pr <url>`, which sets `status: done` and moves the
    file to `tickets/archive/`.

  Each command is one commit pushed straight to `origin/main` from a throwaway worktree. A session
  told to push only to its own branch asks the user before running one.
- A PR that changes a ticket another session holds `in-progress` or `in-review` adds a dated note
  under its `## Status`, and leaves the plan alone.

## Spec PRs

- The spec is amended here, by PR (`spec/BATON_SPEC.md`; its history in
  `spec/BATON_SPEC_HISTORY.md`, one dated changelog entry quoting the owner for each decision).
- CI passing says little about a spec PR. Its check is adversarial review: fresh reviewers given
  the diff and not the author's reasoning, at most three rounds, each finding verified against the
  text before it is fixed. Record each round in the changelog entry.
- Keep the open tickets in sync in the same PR: a ticket whose plan the amendment contradicts is
  rewritten, superseded with a note saying where each item went, or noted; new functionality gets
  a ticket.

## Merging

- Only when the user asks. Merge with a merge commit, passing the exact head sha CI passed on
  (`expectedHeadSha`), so a later push cannot slip in.
- Every push to `main` deploys Baton's server (`baton-deploy.yml`), a merge and every `npm run
  ticket` commit included; say so before merging a PR that changes `src/`.
- After the merge: move the PR's tickets with `npm run ticket -- done` (asking first, as above),
  and if a branch is reused for follow-up work, restart it from the new `main`.
