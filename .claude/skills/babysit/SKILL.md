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
  | `spec/`, `docs/`, `tickets/` | `npm run check:spec`, `npm run check:wiki`, `npm run check:tickets`; for `spec/`, `npm run spec:impact` (below) |
  | `src/`, `cli/`, `scripts/` | `npm run typecheck`, and `npm test` (or `npm run test:no-quint` without quint) |
  | `src/shared/` | never by hand: change it in docs, then `npm run vendor` |
  | `src/migrations/` | only a new numbered file, the next free number at merge (below); never edit an old one |

- **Local failures that are not yours**: a cloud container without `ssh-keygen` or `ssh-agent`
  fails the signing tests (`sign.test.ts`, `cli.test.ts`, `defaults-cli.test.ts`,
  `runner-main.test.ts`, `S-BTN-156.sync-key.test.ts`). Confirm by running the same files on
  `origin/main`; CI is the source of truth for them.

## Bringing in main

- Merge, never rebase or force-push: `git fetch origin main && git merge origin/main`, committed as
  "Merge origin/main into …". The repository's history is merge commits.
- **When.** Merge `origin/main` whenever main has changed `spec/` or `src/migrations/` since the
  branch last merged it — `git diff --quiet $(git merge-base HEAD origin/main) origin/main -- spec
  src/migrations` fails when it has — and at
  least daily for an open PR. Before reviewing, a PR more than a day behind main (the oldest
  main commit it lacks, `git log --reverse --format=%ci HEAD..origin/main | head -1`, is more than
  a day old) merges main first: a review of a stale base
  reviews rulings the branch has not seen. On #160 and #161 the branches built tickets filed
  2026-10-29 as written after the 2026-11-01 rulings, and collided with main on numbers.
- After the merge, re-run the fast checks; `npm run check:spec` catches a requirement or scenario
  id the other side retired.

## Ticket numbers and status

- **Migration and scenario numbers are the next free ones at merge.** Until Baton hands them out
  (B-176), a branch's new migration (`src/migrations/NNNN_*.sql`) or §15 `S-BTN-n` row takes the
  next free number when the PR merges, not when the branch started: merge `origin/main` right
  before merging, and if main took the number, renumber the branch's and every reference it added
  (B-110 and B-107 both took 0028; B-129 and B-145 both took S-BTN-197).
- **Ids are taken on `main`.** `node cli/baton.mjs tickets new` files a ticket with the next free id
  straight onto `main`. A long-running branch that filed a ticket by hand can find its id taken
  when `main` moves. Keep `main`'s ticket and give the branch's the next free id, then change every
  reference the branch added, and only those: check with `git show origin/main:<file> | grep -c <id>`
  that `main`'s copy of a file never named it before rewriting the file.
- **Status follows the PR**, with `node cli/baton.mjs tickets` (B-112's commands):
  - PR opened: `node cli/baton.mjs tickets set <id> in-review --pr <url>`;
  - PR merged: `node cli/baton.mjs tickets done <id> --pr <url>`, which sets `status: done` and moves the
    file to `tickets/archive/`.

  Each command is one commit pushed straight to `origin/main` from a throwaway worktree. A session
  told to push only to its own branch asks the user before running one.
- A PR that changes a ticket another session holds `in-progress` or `in-review` adds a dated note
  under its `## Status`, and leaves the plan alone — except a clause an amendment or ruling
  contradicts, which is struck through with `~~…~~` in place, the note saying what replaced it
  (Spec PRs, below).
- **Claiming re-reads the rules.** `tickets claim` refuses a ticket citing a rule that a
  `spec/BATON_SPEC_HISTORY.md` entry names, dated after the ticket answered for that rule — the
  day it was filed (its `_filed` line, else its file's first commit), or a later `rules re-read`
  note naming the rule; an ordinary edit answers for nothing. Re-read each rule and entry, rewrite
  or strike what they contradict, then claim with `--rules-reread`, which records the re-read in
  `## Status`. `npm run check:tickets` lists such tickets without failing; in a shallow clone it
  skips the list and says so, and `claim` deepens the clone first (`git fetch --unshallow`).

## Spec PRs

- The spec is amended here, by PR (`spec/BATON_SPEC.md`; its history in
  `spec/BATON_SPEC_HISTORY.md`, one dated changelog entry quoting the owner for each decision).
- CI passing says little about a spec PR. Its check is adversarial review: fresh reviewers given
  the diff and not the author's reasoning, at most three rounds, each finding verified against the
  text before it is fixed. Record each round in the changelog entry.
- Keep the open tickets in sync in the same PR: a ticket whose plan the amendment contradicts is
  rewritten, superseded with a note saying where each item went, or noted; new functionality gets
  a ticket.
- **Rewrite or strike the contradicted clause in place.** When an amendment or an owner ruling
  contradicts a clause of a live ticket, the same PR rewrites that clause, or strikes it. A dated
  note beside a clause that still says the opposite is not enough: B-129 kept "listed under Needs
  you" after 2026-11-01's ruling, though a spec PR touched it on 11-02, and the next session built
  the clause. For a ticket another session holds (above), strike the clause with `~~…~~` and say
  in the dated Status note what replaced it; leave the rest of the plan alone. Run `npm run
  spec:impact` with the changed ids and terms to find the tickets. Then add
  `_(<date>: rules re-read: <id>, …)_` under the ticket's `## Status`, naming the ids whose
  amendments the PR handled there: that note, not the edit, is what answers for them at the next
  claim, and only for the ids it names.
- **New tickets say who writes their inputs and what they must not break.** A ticket the PR files
  fills `### Trust` (every new input — a field, a file, a commit trailer, a request — who may write
  it and how Baton verifies it, by `docs/security-model.mdx`'s reaches) and `### Invariants` (the
  rules it must not break, by id, and how the design keeps each); `npm run check:tickets` fails a
  ticket filed on or after `.baton/baton.json`'s `check.sections_since` without them — filed by
  its `_filed` line, or, for a ticket written by hand without one, its file's first commit.
- **Decide in the spec, in the session that decides.** An owner's ruling becomes a spec PR the
  same session, with the history entry quoting it. A ticket may *build* a ruling, but never holds
  its spec half: "the implementing PR amends the spec first" is how B-120's ruling of 2026-10-26
  sat outside the spec while other PRs built on it.
- **Rewrite the rule; never patch it.** An amendment changes the rule's own text. An italic
  exception at its head (`- **R-BTN-n (…).** *Except …*`) over a body that still says the
  opposite fails `npm run check:spec`; the rules written that way before the check are in
  `PATCH_NOTES_ALLOWED`, which only shrinks (B-150).
- **Carry the impact list.** Run `npm run spec:impact -- <every rule id the PR changes> --term
  "<each key phrase of the changed fact>"` and paste its checklist in the PR body, each entry
  marked **changed** or **still true** with a word of why. Terms matter: rules restate facts
  without citing the rule that owns them (R-BTN-63 and R-BTN-83 restated R-BTN-39's position
  without citing it). A **generalisation** ("A and B are one thing") sweeps for every instance
  of the general concept, not only the one at hand: list them in the PR body, each folded in or
  named as left out on purpose.
- **A supersession maps every item.** A note superseding a ticket names, for each numbered item
  and each exit criterion, where it went (rule, ticket, PR) or "nowhere: still open", which then
  gets a ticket. Never "nothing remains" without the map (B-130's item 4 was lost that way).
- **Reviewers get the impact list.** Each fresh reviewer gets the diff and the impact checklist,
  and is told to check the rules the diff did *not* touch that state the same facts, beside
  contradictions, security holes and decisions left to the implementer.

## Merging

- Only when the user asks. Merge with a merge commit, passing the exact head sha CI passed on
  (`expectedHeadSha`), so a later push cannot slip in.
- Every push to `main` deploys Baton's server (`baton-deploy.yml`), a merge and every `npm run
  ticket` commit included; say so before merging a PR that changes `src/`.
- After the merge: move the PR's tickets with `node cli/baton.mjs tickets done` (asking first, as above),
  and if a branch is reused for follow-up work, restart it from the new `main`.
