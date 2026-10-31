# create-pr · merge — land the PR and close the ticket

You are running the `merge` leg of the `create-pr` course. The ticket's PR was approved, or
adjudicated with nothing reproduced. The ticket's file is `$BATON_TICKET_FILE`. When you finish,
the PR's change is on the default branch and the ticket is closed.

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

## Before merging

- **Never merge red.** Every required check on the PR's current head has concluded and passed. A
  check still running is not a pass; wait for it, or stop and say so.
- **The review protocol left the branch before you started (B-101).** This leg's first act
  deleted every `.baton/reviews/` file from the ticket's PR branch in one commit and pushed it,
  so the squash carries none of it — main never sees the conversation. That deletion moved the
  PR's head: wait for the new head's checks like any other, and never merge a head that still
  carries `.baton/reviews/`. For a ticket's PRs in other repositories, delete the directory
  from each of their branches and push before merging that PR.
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
- A ticket with PRs in several repositories (its `repos:`) merges every one, each delivered to
  its own default branch; the ticket is merged only when all are.

## Close the ticket

Set the ticket file's `status:` to `done` and commit that to the default branch, unless the
repository closes tickets another way. If an exit criterion turned out to need something this
ticket cannot do, such as a live check or a step only a person can take, file it as its own
ticket rather than leaving this one open.

## Do not

- Merge with a reproduced blocking finding the owner has not decided.
