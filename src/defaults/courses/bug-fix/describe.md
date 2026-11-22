# bug-fix · describe — reproduce and describe the bug with the reporter

You are working the `describe` leg of the `bug-fix` course: the conversation that turns a
one-line bug report into a ticket another agent can fix without asking anything. The reporter
is in this session with you. This leg is a **person's leg** (R-BTN-116): no runner is offered
it and no claim runs it, so nothing waits for a runner before you start — the reporter works it
here, now, in their own interactive session, and answers it when the ticket reads whole. From
there the ticket is on `create-pr`'s legs: `implement` builds the fix in a PR, the test gate and
the review rounds follow, then `merge`.

## Starting the conversation

The reporter starts an interactive agent session — `claude`, `opencode`, whatever their harness
runs interactively — in a checkout of this repository, with this prompt:

> Follow `.baton/courses/bug-fix/legs/describe.md` in this checkout for ticket `<ticket id>`.
> You and I will reproduce and describe a bug together.

If the reporter is already in a session and only says what is broken, file the ticket first so
the board shows it is being described, then carry on in the same session:

```
npx baton request "<the bug, in one sentence>" --course bug-fix
```

It prints the new ticket's id. The request is committed from a throwaway worktree, so bring
the ticket into this checkout before you edit it: `git pull --ff-only` on the default branch.
The ticket's file is `<items>/<ID>.mdx` (`items` from `.baton/baton.json`, default `tickets`).

## What the conversation produces

The ticket's body, rewritten so `create-pr`'s `implement` leg can fix the bug from it alone.
Keep the frontmatter Baton filed; change only `title` and `description` if the sentence was
wrong, and add `depends_on:` or `repos:` if the fix needs them. The body carries:

- **Symptom** — what the reporter saw, in their words: the error, the output, the screen.
- **Reproduction** — numbered steps from a clean checkout or a named environment, each one you
  ran yourself in this session where you could. Say which steps you could not run and why.
- **Expected and actual** — one line each.
- **Cause** — where the code goes wrong, by file and function, once you have found it; or the
  narrowest place you could pin it to, said as such. Do not write the fix.
- **Scope** — what the fix must not change, and anything near it the reporter said is fine as is.
- **Exit criteria** — checkboxes, each a command that passes, never an opinion:
  - [ ] a regression test that fails on the default branch today and passes with the fix,
        named for the symptom;
  - [ ] the repository's own checks green;
  - [ ] anything the reporter needs to see before they call it fixed.

## The conversation

*This part is for the reporter's interactive session, not for a headless leg.*

- **Read first**: the ticket, the code the symptom points at, and the tickets already filed —
  `npx baton board` or the ticket directory — for one that covers the same cause. If one does,
  say so and ask whether to withdraw this one (`status: withdrawn`) rather than fix it twice.
- **Reproduce before you describe.** Run the steps. A bug you could not reproduce is written up
  as such, with what you tried.
- **One question at a time**, your recommendation first. Ask only what the reporter alone
  knows: what they did, what they expected, which environment, what "fixed" means to them. Read
  the code, the logs and the history yourself.
- **Write as you go**: the ticket's body grows with each answer, so a session that stops early
  leaves its findings in the ticket.
- When the ticket reads whole, show the reporter the body and ask whether it is right.
- **Only on their yes**: commit the ticket's file alone (`git add <its path>`, never `git add
  -A`), as `<ID>: describe — <the title>`, on the default branch, and push it. Then give the
  reporter the command that answers the leg, for them to run with their own key:

  ```
  npx baton decision answer -i <their owner key> <repository>:<ID> filed
  ```

  (or the ticket's Needs-you entry on the dashboard, where the repository's policy lets an
  owner's session answer). Their answer moves the ticket to `filed` and queues `implement` for
  the next runner. Then end the session.
- **If the reporter stops before the ticket is right**, commit what is there, say so, and do not
  give them the answer: the ticket waits at `reported`, on Needs you, and the next session picks
  the conversation up from the ticket's body.

## Do not

- Run `baton decision answer` yourself, or handle the reporter's key: the answer is the
  reporter's act, and it is the only thing that sends the ticket on.
- Write the ticket's machine frontmatter (`station:`, `next_leg:`, `claim:`) or `status: done`.
- Fix the bug in this session, or open a PR: `implement` does that, from the ticket you wrote.
  A failing regression test is the one piece of code worth writing here, and only when the
  reporter wants it; it goes in the ticket's body as a snippet, not on a branch.
