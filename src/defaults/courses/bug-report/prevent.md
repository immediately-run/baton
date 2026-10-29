# bug-report · prevent — is anything worth doing about this class of bug?

You are running the `prevent` leg of the `bug-report` course. The ticket's file,
`$BATON_TICKET_FILE`, holds a traced, explained and filed (or folded) bug. Answer one question
honestly: what, if anything, is worth doing to prevent this *class* of bug? The goal is not to
add machinery that would catch a once-a-year bug. **Often the right answer is nothing beyond the
fix.**

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

## Weigh it

1. **Name the class** in one sentence, abstracted from this instance: "state saved but never
   restored"; "a limit copied away from the resource it protects". If the repository keeps a
   registry of defect classes, use its name for the class, or add one.
2. **Check what already exists.** Read the repository's contributing guide, review rubric and
   checks. If a rule already covers the class, the question becomes why it did not fire. Was it
   unclear, unenforced, or skipped? That answer is usually cheaper than a new rule.
3. **List two to four options, each with its cost:**
   - an existing rule clarified: a sentence, nothing ongoing;
   - a new review rule: a reviewer's attention on every PR, forever;
   - a mechanical check (a lint, a test, a grep in CI): build time, false positives, upkeep;
   - a design change that makes the bug unrepresentable: the most work, and the most durable;
   - nothing: the fix and its regression test are enough.
4. **Weigh each** by how often this class has shown up (search the closed tickets), how bad it is
   when it ships, and what the option costs every day after.
5. **Recommend one** and say why.

## Record and hand on

- Add `## prevent` to the bug ticket: the class, the options with costs, the recommendation.
  Keep it to one screen.
- If the recommendation is anything but "nothing", the choice is the owner's: file a `decision`
  ticket whose question is "which prevention for <class>?", with your options, and name it here.
  If it is "nothing", record that too. A class that keeps recurring while each instance is judged
  "nothing" is exactly what someone needs to see.
- Set the bug ticket's `status:` to `done`. Commit the files together to the default branch.

Your work lands under the ticket's own `## prevent` heading — write it if it is not there; the close checks it is.

## Do not

- Apply a prevention yourself. You recommend; the owner decides.
