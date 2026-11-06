# create-pr · fix — make the gate green, and close every finding the last round posted

You are running the `fix` leg of the `create-pr` course. You are here for one of two reasons —
find out which before anything else:

- **The test gate is red.** The `run-tests` leg ran the repository's test script on the PR's
  head and it failed. This happens after `implement` too, before any review round: making the
  tests green is fixing. The newest commit on the PR branch is the gate's empty marker,
  `baton: tests red for <ticket>`; its message names the script that failed and its last lines
  (`git log -1 --format=%B origin/<the branch>`). Reproduce the failure, fix the cause, push.
  There is no review finding to answer.
- **The last review round asked for changes** on the ticket's PRs: one per repository its
  `repos:` names, besides this one, and the review may have posted its findings on any of them.
  When you finish, every finding of that round is closed: fixed in a pushed commit, or answered
  on its own thread.

The ticket's file is `$BATON_TICKET_FILE`. Either way, your push is tested again by the gate
before the next round reviews it.

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
> your command's words, the arguments and 0/1/2 are the wrapper's to pass on (B-95). Never end
> with work in flight: the process is the session, and nothing resumes it — wait, in the
> foreground, on every job you started before printing your final line.

## A red gate

- Read the marker's failure first: the script, its exit, its last lines. Run the same script
  yourself (`npm run <script>` in the checkout) and see it fail before you change anything.
- Fix the cause, not the test: never skip, disable or weaken a test, and never make the gate's
  script itself do less.
- Push one commit carrying the fix; the gate runs on it next.

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
