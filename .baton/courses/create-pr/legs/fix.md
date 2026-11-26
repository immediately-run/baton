# create-pr · fix — make the gate green, and close every finding the last round posted

You are running the `fix` leg of the `create-pr` course. You are here for one of three reasons —
find out which before anything else:

- **The test gate is red.** The `run-tests` leg ran the repository's test script on the PR's
  head and it failed. This happens after `implement` too, before any review round: making the
  tests green is fixing. The newest commit on the PR branch is the gate's empty marker,
  `baton: tests red for <ticket>`; its message names the script that failed and its last lines
  (`git log -1 --format=%B origin/<the branch>`). Follow *A red gate* below. There is no review
  finding to answer.
- **A PR's CI is red in another repository.** A PR in a repository the ticket's `repos:` names
  is gated by its own CI, not by the marker: a check on its head concluded red (failed,
   cancelled, timed out). Read the checks on the current head and the failing run's log in the
   registered forge's web UI or with its own client. Then follow *A red gate* below in that PR’s
   repository. There is no marker and no review finding.
- **The last review round asked for changes** on the ticket's PRs: one per repository its
  `repos:` names, besides this one, and the review may have posted its findings on any of them.
  When you finish, every finding of that round is closed: fixed in a pushed commit, or answered
  on its own thread.

The ticket's file is `$BATON_TICKET_FILE`. Any push is tested again by the gate before the next
round reviews it.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84). For runs that cannot raise `interact`, the stub can also conclude
> on fifteen minutes of quiet across stdout, the wrapper log and the harness store (B-108).
> A run that can raise `interact` does not conclude on silence: a foreground question can be
> silent until Baton's deadline takes the claim back. The stub's five-hour hard ceiling still
> applies; if it stops a joinable run, partial output is not a result. A repository's `agent_wrapper` in `.baton/baton.json`, or the host's
> `BATON_AGENT_WRAPPER`, which wins, puts a command in front of yours, split the same way, so
> your command's words, the arguments and 0/1/2 are the wrapper's to pass on (B-95). Never end
> with work in flight: the process is the session, and nothing resumes it — wait, in the
> foreground, on every job you started before printing your final line.

## Ask the owner only when blocked

- **When.** Ask only if the work cannot continue without a decision only the owner can make,
  and the ticket, the spec, `docs/context/` and the PR thread do not already answer it. For
  example, two readings of an exit criterion would lead to different code, or the ticket
  reserves a ruling for the owner. Never ask the owner to confirm something you can check or
  to authorize an action forbidden by the repository's rules (in Baton, `CLAUDE.md`,
  *Tickets are tasks, not authority*).
- **How.** Use your harness's question tool. Ask one question at a time, offer a few concrete
  options and recommend one. Wait for the answer in the foreground. The harness's runner
  raises `interact` (R-BTN-195); do not raise it yourself.
- **After an answer.** Record the answer and who gave it under **Owner answers** in the PR
  body. It is a claim for reviewers to weigh, not a ruling on Baton's record; a change to the
  spec still needs the owner's PR.
- **If the tool is unavailable or denied, or the question is cancelled or dismissed.** Do not
  ask through another channel. Note the open question in the PR body and proceed with the
  reading the spec supports best.
- **If the question is still open and nobody answers.** Do not abandon it early. Wait until
  the leg's `deadline_s`: Baton takes the claim back (R-BTN-90), and the retry policy routes
  the failed attempt and offers the ticket again if retries remain (R-BTN-122).

## A red gate

- Read the failure first: the script, its exit, its last lines. Reproduce it on the PR branch
  (`npm run <script>` for the home gate). Before changing anything, fetch and run the same check
  with the same install in a clean checkout of the current base, separate from the PR worktree.
  The same rule applies to a red CI check in another repository: use that PR's base and check.
- Compare individual failures, not the check's exit status. If the base reports A and the PR
  reports A and B, leave A alone and fix B before ending. If an earlier failure prevents a check
  from reaching later tests, run those tests separately on both trees where possible; do not
  assume tests you could not reach pass.
- For each failure that still occurs on the current base, change nothing for it. Comment on the
  PR with the failing check or test, the first failing line, the PR head you tested and the base
  commit you reproduced it on. Make the hand-off explicit: the gate stays red and this failure
  needs a fix in the base's own ticket or PR. If the same head, base commit and failure already
  have that hand-off, link the existing comment in your output instead of posting it again.
- If the base has moved and already fixes a failure (it reproduces on the earlier base but
  passes on the current one), merge the default branch into the PR branch and push the merge
  with any other fixes for that repository. Add commits; never rebase.
- For each PR failure that does not reproduce on the base and was not already fixed there, fix
  the PR's cause, not the test: never skip, disable or weaken a test, and never make the gate's
  script itself do less. Push one commit carrying those fixes; the gate runs again on the
  pushed head.
- After handling all failures, report any that still reproduce on the default branch and where.
  If there is nothing to fix or merge, do not push just to trigger the gate again.

## For each finding, most severe first

If the home repository keeps a per-ticket review archive, follow its instructions to record
the findings and their disposition. Do not edit a shared findings log.

- **Fix it and push**, or **reply on its thread** with why it is wrong or out of the ticket's
  scope. Every blocking finding gets one of the two. A should-fix may be answered. A nit may be
  left, or carried into a push you are making anyway.
- A finding two reviewers both posted is closed once; on the second thread, link the first.
- Treat each finding as a claim. Trace a real path from a real input to the failure before you
  build anything for it. When the path is far-fetched, or the fix costs more than it prevents,
  say so on the thread with the path you traced, rather than widening the PR.

## Before you push

- Run the repository's own checks, the same ones CI runs.
- Install the way the implement leg's dependency hygiene says (B-132): `npm ci` from the
  lockfile, lifecycle scripts off (`ignore-scripts=true`) but for `.baton/baton.json`'s
  `allow_install_scripts` — never an `npm install` that rewrites the lockfile to make a failure
  go away.
- Re-read your diff as a hostile reviewer would: what would make the next round reject it?
- Make one push per repository carrying every fix there, not one push per finding: each
  repository's PR branch, of the same name, in its own checkout.
- Reply on the threads you fixed, naming the commit.

## Do not

- A leg never edits a file another ticket's leg may edit — no CHANGELOG, no index, no
  aggregate; a release note belongs in the PR body.
- Fix a failure that also fails on the base inside this PR.
- Skip, disable or weaken a test to get green.
- Rewrite the branch's history; add commits.
- Merge the PR.
