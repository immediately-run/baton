# create-pr · fix — close every finding the last round posted

You are running the `fix` leg of the `create-pr` course. The last review round asked for changes
on the ticket's PRs: one per repository its `repos:` names, besides this one, and the review may
have posted its findings on any of them. The ticket's file is `$BATON_TICKET_FILE`. When you
finish, every finding of that round is closed: fixed in a pushed commit, or answered on its own
thread.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84). A repository's `agent_wrapper` in `.baton/baton.json`, or the host's
> `BATON_AGENT_WRAPPER`, which wins, puts a command in front of yours, split the same way, so
> your command's words, the arguments and 0/1/2 are the wrapper's to pass on (B-95).

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

- A leg never edits a file another ticket's leg may edit — no CHANGELOG, no index, no
  aggregate; a release note belongs in the PR body.
- Skip, disable or weaken a test to get green.
- Rewrite the branch's history; add commits.
- Merge.
