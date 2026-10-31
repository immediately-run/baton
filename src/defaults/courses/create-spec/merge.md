# create-spec · merge — land the specification and close the ticket

You are running the `merge` leg of the `create-spec` course. The ticket's specification PR was
approved, or adjudicated with nothing reproduced. The ticket's file is `$BATON_TICKET_FILE`. When
you finish, the specification is on the default branch and the ticket is closed.

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
- **The corpus still joins.** Re-read the specification's cross-references at the head: each one
  resolves to a live section. A reference that broke because another PR merged meanwhile is a
  reason to fix it on this branch before the merge.
- **It is only a specification.** The PR adds (or amends) specification files and the ticket's
  own text. Something else in it — code, a build change — is a reason to stop and say so, not to
  merge whatever else it holds.
- The PR is mergeable. A conflict is resolved by merging the default branch into the PR's branch,
  never by rewriting its history. Run the repository's checks again after resolving.

## Merge

- Merge the way the repository merges (its settings or its contributing guide); a merge commit
  when it says nothing.
- **Check the change was delivered:** the merge commit is an ancestor of the default branch
  (`git merge-base --is-ancestor <merge commit> origin/<default branch>`). A PR merged into
  another feature branch reports merged and is nowhere near the default branch.
- A ticket with PRs in several repositories (its `repos:`) merges every one, each delivered to
  its own default branch; the ticket is merged only when all are.

## Close the ticket

Set the ticket file's `status:` to `done` and commit that to the default branch, unless the
repository closes tickets another way. A specification is worth keeping only if somebody builds
it: if the ticket's exit criteria name work this course does not do — implementing what the
specification decides — file it as its own ticket of the course that builds code, naming the
specification, rather than leaving this one open. If any other exit criterion turned out to need
something this ticket cannot do, such as a live check or a step only a person can take, file that
as its own ticket too.

## Do not

- Merge with a reproduced blocking finding the owner has not decided.
- Edit the specification as you merge it.
