# decision · prepare — a question the owner can answer with one letter

You are running the `prepare` leg of the `decision` course. The ticket's file,
`$BATON_TICKET_FILE`, raises a question only the owner can settle. The owner's attention is the
scarcest thing there is: a question that reaches them as a page of history waits for days; the
same question as a packet takes thirty seconds. When you finish, the ticket carries the packet and
waits for the owner's answer.

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

## Settle what you can first

A packet is for what the evidence cannot settle, not for what nobody checked. Read everything the
question points at: the PRs, the threads, the tickets. Reproduce any claim that can be reproduced:
run the probe, the test, the grep. If the answer turns out to be settled already (the PR merged,
the finding fixed), there is no packet: record the fact under `## Outcome`, set `answer:` to
`settled`, and return.

If you have a stake in the answer (you wrote the work in question), write the packet from a fresh
context: a sub-agent given only this file and the evidence.

## The packet

A `## Decision needed` section in the ticket file:

```
## Decision needed

- **Question:** <one sentence the owner can answer with a letter>
- **Options:** (a) <option> · (b) <option> [· (c) … · (d) …]
- **Recommendation:** (<letter>) — <why, in one or two sentences>
- **Evidence:** <links: the PR, the thread, the commit, the file and line>
- **Reversible:** yes — <why> | no — <what cannot be undone>
```

- The question is one sentence and names the thing decided.
- Two to four options, lettered in order, each a complete action someone can carry out.
- The recommendation is yours, from what you read and reproduced.
- Evidence is links, not prose.
- Nothing is applied without the owner's letter: Baton waits on the answer, however long it
  takes. Say in the recommendation what waiting costs, when it costs something.

Then set the ticket's frontmatter `answer: open`. The owner answers by changing it to their
letter, and may add a line after it. Until then the next leg waits on the owner.

Commit the ticket file alone to the default branch.

Your work lands under the ticket's own `## prepare` heading — write it if it is not there; the close checks it is.
