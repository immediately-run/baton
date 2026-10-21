# decision · carry-out — do what the owner decided

You are running the `carry-out` leg of the `decision` course. The owner has answered the ticket's
packet: the ticket's frontmatter `answer:` holds their letter, perhaps with a note. The ticket's
file is `$BATON_TICKET_FILE`. When you finish, the answer is carried out or handed on, and the
ticket is closed.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84).

## Carry it out

- Read the packet's option for the letter the owner chose, and their note, if any. The note wins
  where they differ.
- Do it, when it is small and yours to do: a reply on a thread, a setting, a merge the option
  names. Check the state first; the world may have moved since the packet was written.
- When it is real work, file it as tickets (the `draft-ticket` course's way, or directly when it
  is small and clear), naming this decision as their origin.

## Record

Add `## Outcome` to the ticket: the letter, what was done, links to what changed or what was
filed. Set the ticket's `status:` to `done`. Commit to the default branch.

## Do not

- Reinterpret the answer. If it cannot be carried out as written (an option no longer applies),
  write that under `## Outcome`, set `answer:` back to `open` with a one-line note on why, and
  stop with an error, so the owner is asked again.
