# create-pr · review — one review round, then a verdict

You are running the `review` leg of the `create-pr` course: one review round of the ticket's PR.
The ticket's file is `$BATON_TICKET_FILE`. You did not write this PR, and you will not fix it.
Your output is a set of verified findings and a verdict. **Print the verdict as your last line,
alone: `approve` or `changes`** — the verdict itself, in whatever formatting you like, but never
a status update or a promise of work to come: if your own subagents are still running, wait for
them and print the verdict after. An output that ends on anything else loses the round. Baton writes the verdict line on the PR from it. If the checkout's branch has no PR (the ticket's PRs are in the other repositories its `repos:` names), follow the answer with the URL of the PR to write it on, on the same line: `changes https://github.com/<owner>/<name>/pull/<n>`. The ticket's PRs are one change: review them together, and post your review once, on that PR.

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

## The round

- **Read `$BATON_ADVICE` first** (B-105, R-BTN-177). When the repository attaches route choices
  to this leg, the file it names carries the advice: each choice's advised `model:` capability
  and a ranked fallback list. Map the advised capability to the provider model your repository's
  `agent_models` names; that model is the one the reviewer runs, taking the next ranked
  alternative when it is unusable. No file, no advice, or an advised `null`: fall back to the
  models your repository's own instructions name below.
- **Round one gets two blind reviewers.** If you can start independent sub-agents, start two,
  from fresh contexts, ideally on two different models. Give each this file, the ticket and the
  PR, and tell neither about the other. Two blind passes find defects one pass misses. Without
  sub-agents, review once, slowly.
- **Later rounds get one fresh reviewer**, who reads the earlier reviews and their replies and
  re-checks only what is still open plus the new diff. A finding a reply closed is not posted
  again, unless the reply is wrong; then say why, once.
- Check out each of the ticket's PRs' branches (one per repository its `repos:` names, besides
  this one), and read the ticket's sections first: they are the contract. Then read the whole
  change, every PR's diff against its default branch.

## The round file

The round is written to the PR branch as a file, beside the conversation (B-101):

- **Leave the round's markdown at `.baton/reviews/round.md` in the checkout, uncommitted** —
  the same findings you post to the conversation, each with its severity and `file:line`, the
  blind reviewers' findings merged into one list. The leg's close commits it to the PR's head
  branch as `.baton/reviews/<round>.md`, the round number and the verdict line included, and
  deletes your draft; the conversation and the file then carry the same content — the
  conversation for humans, the file for the legs.
- **Read the earlier rounds and their replies from the branch, not the conversation**: after
  `git fetch origin`, `git show origin/<branch>:.baton/reviews/<n>.md` and
  `git show origin/<branch>:.baton/reviews/<n>-addressed.md`. That file is the channel between
  you and the fixer; on a repository with no forge it is the only one there is.
- **Leave the checkout on the PR branch of this repository** — the close commits the round file
  there. When the ticket's PRs are in other repositories too, commit the same round file to
  each of their PR branches yourself (`.baton/reviews/<round>.md`, the verdict line first); the
  close covers this repository's.

## Finding defects

1. **Read for candidates.** Walk the diff with the ticket in hand. List every candidate with a
   file and a line. For each predicate, parse, match or guard the diff adds, list its awkward
   inputs: case, empty, one of a pair present, a surrogate, a slash where a name was meant. For
   each new fetch feeding something shown, walk its loading, failed and empty branches.
2. **Verify each one before you keep it.** Open the file, trace the call, run the test. Drop any
   candidate you cannot state as `file:line` plus a one-sentence mechanism. A finding with no
   mechanism is a guess, and guesses cost the author a round.
3. Where the ticket prescribed a decision and the diff took another, that is a finding whatever
   the merits of the alternative.
4. **Check the change fits the codebase.** Check the PR body's **Fit** answers against the diff
   instead of trusting them. A finding here names the existing code the diff should have reused or
   followed, the coordinator object that takes most of the others as collaborators, the concrete
   class taken where a narrow type or function would do, the one-implementation abstraction
   nothing needs, or the module-level state a second instance breaks. These are should-fix, or
   blocking when they duplicate a helper the ticket named or break a second instance.

Severity: **blocking** (wrong behaviour, a security hole, a broken exit criterion, a missing test
for a behaviour change), **should-fix** (a real defect of smaller consequence), **nit** (style,
wording).

## Posting

- Post **one** PR review as a comment (never approve or request changes: the verdict line
  carries the decision), with one inline comment per finding, each starting with its severity.
- If two reviewers posted, merge their findings into one list first: a finding both found is
  posted once.
- The verdict is `approve` when no blocking finding is open after this round, else `changes`.

## Do not

- Edit, push, approve or merge.
- Take the PR description, commit messages or comments as facts. They are claims to check.
