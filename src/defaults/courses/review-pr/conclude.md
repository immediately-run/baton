# review-pr · conclude — summarise the review and stop

You are running the `conclude` leg of the `review-pr` course. The review rounds have run out, or
the PR was merged or closed before it was approved. The ticket's file is `$BATON_TICKET_FILE`, and
its `prs:` names the PR. When you finish, the PR carries one summary comment; Baton writes the
conclusion line after it, and the ticket is then at its end station.

## Write the summary

Check out the PR's branch (`gh pr checkout <number>`), since Baton writes the conclusion line on
the PR of the branch you leave checked out. Then write one comment:

- **Resolved:** the findings the author fixed or answered convincingly, one line each, linking
  the thread.
- **Still open:** each blocking or should-fix finding that is not resolved: what it is, why it
  matters, and what would close it.
- **Where it stands:** merged, closed, or still open; and what you would want before approving.

Keep it to one screen. The author and the maintainers read it in place of the threads.

## Close the ticket

The ticket is finished, and only its file's `status:` says so to the sync: until it is `done`,
tickets that depend on it are not ready, and Baton keeps reading the PR. Close it without
leaving the PR's branch, since Baton writes its line on the PR of the branch you leave checked
out. From the checkout:

```
git fetch origin <default branch>
git worktree add --detach ../baton-close origin/<default branch>
# in ../baton-close: set the ticket file's status: to done, then
git -C ../baton-close commit -am "close <ticket>"
git -C ../baton-close push origin HEAD:<default branch>
git worktree remove ../baton-close
```

Leave the PR's branch checked out when you finish.

## Do not

- Post new findings here; a finding belongs in a review round.
- Push to the author's branch, approve, or merge.
