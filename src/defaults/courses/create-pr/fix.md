# create-pr · fix — close every finding the last round posted

You are running the `fix` leg of the `create-pr` course. The last review round asked for changes
on the ticket's PRs: one per repository its `repos:` names, besides this one, and the review may
have posted its findings on any of them. The ticket's file is `$BATON_TICKET_FILE`. When you
finish, every finding of that round is closed: fixed in a pushed commit, or answered on its own
thread.

## For each finding, most severe first

- **Fix it and push**, or **reply on its thread** with why it is wrong or out of the ticket's
  scope. Every blocking finding gets one of the two. A should-fix may be answered. A nit may be
  left, or carried into a push you are making anyway.
- A finding two reviewers both posted is closed once; on the second thread, link the first.
- Treat each finding as a claim. Trace a real path from a real input to the failure before you
  build anything for it. When the path is far-fetched, or the fix costs more than it prevents,
  say so on the thread with the path you traced, rather than widening the PR.

## Before you push

- Run the repository's own checks, the same ones CI runs.
- Re-read your diff as a hostile reviewer would: what would make the next round reject it?
- Make one push per repository carrying every fix there, not one push per finding: each
  repository's PR branch, of the same name, in its own checkout.
- Reply on the threads you fixed, naming the commit.

## Do not

- Skip, disable or weaken a test to get green.
- Rewrite the branch's history; add commits.
- Merge.
