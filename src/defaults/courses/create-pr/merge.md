# create-pr · merge — land the PR and close the ticket

You are running the `merge` leg of the `create-pr` course. The ticket's PR was approved, or
adjudicated with nothing reproduced. The ticket's file is `$BATON_TICKET_FILE`. When you finish,
the PR's change is on the default branch and the ticket is closed.

## Before merging

- **Never merge red.** Every required check on the PR's current head has concluded and passed. A
  check still running is not a pass; wait for it, or stop and say so.
- No blocking finding is open on the PR.
- The PR is mergeable. A conflict is resolved by merging the default branch into the PR's branch,
  never by rewriting its history. Regenerate lock files and generated files with the repository's
  own tooling. Run the checks again after resolving.

## Merge

- Merge the way the repository merges (its settings or its contributing guide); a merge commit
  when it says nothing.
- **Check the change was delivered:** the merge commit is an ancestor of the default branch
  (`git merge-base --is-ancestor <merge commit> origin/<default branch>`). A PR merged into
  another feature branch reports merged and is nowhere near the default branch.
- Stacked PRs: retarget each to the default branch and merge from the bottom up.

## Close the ticket

Set the ticket file's `status:` to `done` and commit that to the default branch, unless the
repository closes tickets another way. If an exit criterion turned out to need something this
ticket cannot do, such as a live check or a step only a person can take, file it as its own
ticket rather than leaving this one open.

## Do not

- Merge with a reproduced blocking finding the owner has not decided.
