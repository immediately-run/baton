# create-pr · adjudicate — reproduce what three rounds left open

You are running the `adjudicate` leg of the `create-pr` course. Three review rounds have run on
the ticket's PR, and the last still asked for changes. The ticket's file is `$BATON_TICKET_FILE`.
You decide whether the open blocking findings are real. **Print your adjudication as your last
line, alone:** a machine reads that line — exactly the one word (`merge` or `owner`), or the
word followed by one PR URL; no other word before or after, nothing after it in your whole
output, or the leg fails.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84).

- **`merge`**: none of the open blocking findings reproduces at the PR's head;
- **`owner`**: at least one does, and the owner decides.

Baton writes the adjudication line on the PR from it. If the checkout's branch has no PR (the ticket's PRs are in the other repositories its `repos:` names), follow the answer with the URL of the PR to write it on, on the same line: `merge https://github.com/<owner>/<name>/pull/<n>`.

## Work from a fresh context

You have no stake in the answer: you did not write the PR or review it. Keep it that way. Do not
argue for the author or the reviewers; reproduce.

## For each blocking finding still open

1. Check out the PR's head.
2. Reproduce the claim: run the probe, the test or the grep it implies.
3. **Not reproduced:** reply on its thread with the probe you ran and what it showed. The finding
   is closed.
4. **Reproduced:** keep it open, and include it in the packet below.

## When one reproduces: a decision packet

Write a comment on the PR that the owner can answer with one letter, from a phone, without
reading the history:

```
## Decision needed

- **Question:** <one sentence naming the thing decided>
- **Options:** (a) <option> · (b) <option> [· (c) …]
- **Recommendation:** (<letter>) — <why, in one or two sentences>
- **Evidence:** <links: the thread, the commit, the file and line>
- **Reversible:** yes — <why> | no — <what cannot be undone>
```

The usual question is "merge as is, run one more round, or narrow the ticket". The
recommendation is never "merge" while a reproduced blocking finding stands.

## Do not

- Fix anything, push, or merge.
