# create-spec · address — answer every blocking finding with the owner, in conversation

You are running the `address` leg of the `create-spec` course. The last review round asked for
changes on the ticket's specification, and someone has to decide how each blocking finding is
answered. Unlike `create-pr`'s `fix`, this is **not** a headless fix: the owner and an agent
session decide, together, what the specification should say. The ticket's file is
`$BATON_TICKET_FILE`. This leg ends with the ticket waiting: when you return, Baton's `close`
records the round in the ticket's own frontmatter and ends the claim, and the ticket waits on the owner until
the amendment lands as a push on the PR; the next sync moves it back to `spec-open` and the next
round reviews it. `address` runs at most three times: after the third round that still asks for
changes, the course queues `adjudicate` instead, and a fresh reader decides whether what is left
reproduces.

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

## Starting the conversation

Interactive legs run as the owner's own session, in a checkout of this repository: start it with
whatever interactive agent your harness has — `claude`, `opencode`, another — and give it this
prompt:

> Follow the `## The conversation` section of `.baton/courses/create-spec/legs/address.md` in this
> checkout for ticket `<ticket id>` (its file is named by `$BATON_TICKET_FILE`). The latest review
> round's blocking findings are on the PR; you and I will decide how each is answered, then you
> amend the specification and push.

Once Baton launches interactive legs itself, the runner sends the link to the session instead —
"the runner sends the link once B-34 lands" — and the rules do not change.

## How the ticket waits

**Baton records the round, not you**: when you return, this leg's `close` writes the round
into the ticket's own frontmatter — `station: reviewed`, `next_leg: address`, the claim's nonce —
commits the ticket alone on the default branch, and pushes it. From that record on
the sync holds `address` **waiting on the owner** — one conversation per round, not one per sync —
until the amendment's push lands and the ticket moves back to `spec-open`. Do not write, amend or
delete that state. If the PR is closed without merging, the ticket keeps waiting on the owner:
closing a PR answers no finding, so the owner reopens it, or files a fresh request.

## The conversation

*This part is for the owner's interactive session, not for a headless leg.*

- **Read first**: the ticket, the specification, the latest review round and the rounds before it,
  and the corpus the findings cite. Every finding is a claim: open the cited sections yourself
  before deciding anything about it.
- **Take the blocking findings one at a time, most severe first**, and put the decision to the
  owner with a recommendation: "(a) fix it — the specification should say …, because …; (b) argue
  it — the finding misreads …, and the reply quotes …; (c) split it — it needs more than this
  ticket, and the child ticket would be …". The owner chooses; write the choice down.
- **A should-fix may be answered, a nit left.** Do not spend the owner's attention on them.
- **The amendment is the specification's**, not the review's: fix the rule, the scenario, the
  vocabulary or the reference that is wrong — never soften a rule to make a finding go away. If
  two findings contradict each other, say so and ask which wins.
- **Reply on each thread** as you go: the fix's commit for (a), the reasoning with its citations
  for (b), the child ticket's name for (c). A finding two reviewers both posted is answered once;
  on the second thread, link the first.
- **Before the push**: re-read the diff as the next round's reviewer would, and run the
  repository's own checks (link check, spec check — whatever a contributor runs).
- When every blocking finding has an answer, read the owner the list — finding, what was decided,
  what changed — and ask whether to push. **Only on their yes**: commit on the PR's branch (with
  explicit paths, never `git add -A`; add commits, never rewrite the branch's history), push once
  with every answer in it, reply on the threads you fixed naming the commit, and end the session.

Record the round under the ticket's own `## address` heading when you write in the ticket; this leg's close checks no heading — its record is the frontmatter state, and its work is the PR.

## Do not

- Mark the ticket `done`: this leg decides nothing about the ticket, and the board reads the PR —
  its reviews, their verdicts, the pushes between them — not a field. The `merge` leg closes the
  ticket once the PR is merged.
- Push without the owner's yes, or make a decision the owner reserved for themselves.
- Skip, disable or weaken a check to get green.
- Merge, approve or adjudicate the review. Later legs do that.
