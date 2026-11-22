# new-feature · specify — shape the feature with the requester

You are working the `specify` leg of the `new-feature` course: the conversation that turns a
one-line feature request into a ticket another agent can build without asking anything. The
requester is in this session with you. This leg is a **person's leg** (R-BTN-116): no runner is
offered it and no claim runs it, so nothing waits for a runner before you start — the requester
works it here, now, in their own interactive session, and answers it when the ticket reads whole.
From there the ticket is on `create-pr`'s legs: `implement` builds it in a PR, the test gate and
the review rounds follow, then `merge`.

## Starting the conversation

The requester starts an interactive agent session — `claude`, `opencode`, whatever their harness
runs interactively — in a checkout of this repository, with this prompt:

> Follow `.baton/courses/new-feature/legs/specify.md` in this checkout for ticket `<ticket id>`.
> You and I will specify a feature together.

If the requester is already in a session and only says what they want, file the ticket first so
the board shows it is being specified, then carry on in the same session:

```
npx baton request "<the feature, in one sentence>" --course new-feature
```

It prints the new ticket's id. The request is committed from a throwaway worktree, so bring the
ticket into this checkout before you edit it: `git pull --ff-only` on the default branch. The
ticket's file is `<items>/<ID>.mdx` (`items` from `.baton/baton.json`, default `tickets`).

## What the conversation produces

The ticket's body, rewritten so `create-pr`'s `implement` leg can build the feature from it
alone. Keep the frontmatter Baton filed; change only `title` and `description` if the sentence
was wrong, and add `depends_on:` or `repos:` if the work needs them. The body carries:

- **What and for whom** — three sentences: what the feature is, who uses it, why they would.
- **Behaviour** — what it does, as the user meets it: the inputs, the outputs, the states, the
  errors. Name the screens, commands or endpoints it adds or changes.
- **Out of scope** — what it deliberately does not do, so the review does not ask for it.
- **Decisions** — every choice the requester settled (a name, a default, what wins when two
  rules meet), one line each, so `implement` takes them rather than re-deciding.
- **Where it goes** — the code it will touch, by file, and the existing code it should follow.
- **Exit criteria** — numbered acceptance criteria, each a checkbox and a command that passes,
  never an opinion: the tests that show each behaviour, and the repository's own checks green.

A feature too large for one PR is a sign it is several: say so, and offer to file the rest as
tickets of their own (`baton request … --course new-feature`), each with `depends_on:` where
order matters, keeping this one to the first.

## The conversation

*This part is for the requester's interactive session, not for a headless leg.*

- **Read first**: the ticket, the code the feature joins, and the tickets already filed —
  `npx baton board` or the ticket directory — for one that already asks for it. If one does,
  say so and ask whether to withdraw this one (`status: withdrawn`).
- **One question at a time**, your recommendation first: "(a) is what I'd do, because …; (b)
  would cost …". Ask only what the requester alone can settle — the user, the scope, what wins
  when two goals collide. Read the code yourself.
- **Say when the request contradicts the code or the repository's own rules**, and ask which
  wins rather than deciding alone.
- **Write as you go**: the ticket's body grows with each answer, so a session that stops early
  leaves its decisions in the ticket.
- When the ticket reads whole, read the requester the three sentences, the decisions and the
  acceptance criteria, and ask whether they are right.
- **Only on their yes**: commit the ticket's file alone (`git add <its path>`, never `git add
  -A`), as `<ID>: specify — <the title>`, on the default branch, and push it. Then give the
  requester the command that answers the leg, for them to run with their own key:

  ```
  npx baton decision answer -i <their owner key> <repository>:<ID> filed
  ```

  (or the ticket's Needs-you entry on the dashboard, where the repository's policy lets an
  owner's session answer). Their answer moves the ticket to `filed` and queues `implement` for
  the next runner. Then end the session.
- **If the requester stops before the ticket is right**, commit what is there, say so, and do
  not give them the answer: the ticket waits at `requested`, on Needs you, and the next session
  picks the conversation up from the ticket's body.

## Do not

- Run `baton decision answer` yourself, or handle the requester's key: the answer is the
  requester's act, and it is the only thing that sends the ticket on.
- Write the ticket's machine frontmatter (`station:`, `next_leg:`, `claim:`) or `status: done`.
- Build the feature in this session, or open a PR: `implement` does that, from the ticket you
  wrote.
