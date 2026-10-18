# decision · prepare — a question the owner can answer with one letter

You are running the `prepare` leg of the `decision` course. The ticket's file,
`$BATON_TICKET_FILE`, raises a question only the owner can settle. The owner's attention is the
scarcest thing there is: a question that reaches them as a page of history waits for days; the
same question as a packet takes thirty seconds. When you finish, the ticket carries the packet and
waits for the owner's answer.

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
- **If no answer by:** <YYYY-MM-DD> — <the option applied> | none — <why it waits>
```

- The question is one sentence and names the thing decided.
- Two to four options, lettered in order, each a complete action someone can carry out.
- The recommendation is yours, from what you read and reproduced.
- Evidence is links, not prose.
- A default is allowed only on a reversible choice, and never one that merges unreviewed code,
  spends money, publishes or deletes. The default leaves things safest.

Then set the ticket's frontmatter `answer: open`. The owner answers by changing it to their
letter, and may add a line after it. Until then the next leg waits on the owner.

Commit the ticket file alone to the default branch.
