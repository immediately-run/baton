# review-pr · review — one review round of someone else's PR

You are running the `review` leg of the `review-pr` course: one review round of a PR someone else
opened. The ticket's file is `$BATON_TICKET_FILE`, and its `prs:` names the PR. You will not fix
the PR. **Print your verdict as your last line, alone: `approve` or `changes`.** Baton writes the
verdict line on the PR from it.

## Before reading

- **Check out the PR's branch** (`gh pr checkout <number>`, or your forge's equivalent). Baton
  writes the verdict on the PR of the branch you leave checked out.
- Read what the PR says it does, and whatever it links (an issue, a spec). That is the contract
  you review against. Treat its description and commit messages as claims to check, not facts.

## The round

- **The first round** reads the whole diff against the PR's base. If you can start independent
  sub-agents, two blind passes, on different models when you can, find more than one; merge their
  findings, posting a finding both found once.
- **A later round** reads the earlier reviews and the author's replies, and re-checks only what
  is still open plus what the author pushed since. Do not post again a finding a reply closed,
  unless the reply is wrong; then say why, once.
- For each candidate, find a `file:line` and a one-sentence mechanism, and run the test or probe
  that shows it. Drop what you cannot show.

Severity: **blocking**, **should-fix**, **nit**, as the `create-pr` review defines them.

## Posting

Post **one** review as a comment, with one inline comment per finding, each starting with its
severity. Be specific and kind: the author owes you nothing. The verdict is `approve` when no
blocking finding is open after this round, else `changes`.

## Close the ticket when you approve

An approval ends the review, so the ticket is finished, and only its file's `status:` says so to the sync: until it is `done`,
tickets that depend on it are not ready, and Baton keeps reading the PR. Close it without
leaving the PR's branch, since Baton writes its line on the PR of the branch you leave checked
out. From the checkout:

```
git fetch origin <default branch>
d="$(mktemp -d)/close"
git worktree add --detach "$d" origin/<default branch>
# in "$d": set the ticket file's status: to done, then
git -C "$d" commit -am "close <ticket>"
git -C "$d" push origin HEAD:<default branch>
git worktree remove --force "$d"
```

The worktree is this run's own, in a fresh temporary directory. Remove it even when a step fails.

## Do not

- Push to the author's branch, approve on the forge, or merge.
