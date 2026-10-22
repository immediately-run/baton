# build-app · design — design the interface and mock it up

You are running the `design` leg of the `build-app` course. The ticket's file is
`$BATON_TICKET_FILE`; the owner approved its product definition,
`product/<ticket id>/PRODUCT.md`. When you finish, `product/<ticket id>/DESIGN.md` describes every
screen and `product/<ticket id>/mockups/` holds a mock-up of each, and the ticket waits for the
owner to refine and approve them. Baton's closing marker is written for you after you return; do
not write it.

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

## 1. Read first

- `PRODUCT.md` whole, with its `## Decisions`: they are settled, and this leg does not reopen
  them. If the design shows one cannot work, say so as a question below.
- **An existing interface.** If the repository already has one, its design system wins: its
  tokens, components, type, spacing and voice. Find them by name and use them; a new screen looks
  like the rest of the product.

## 2. Write `product/<ticket id>/DESIGN.md`

- **Screens** — every screen and overlay, each with: its purpose in a line; what it shows; every
  action on it and where each goes; its states — empty, loading, error, and the ones particular to
  it (a game's waiting-for-opponent, an illegal move, game over); and the acceptance criteria
  (`AC-n`) it serves.
- **Flows** — the core loop of `PRODUCT.md`, screen by screen, and each other path a person takes
  (first visit, returning, sharing, recovering from an error).
- **Interaction rules** — how input works where it is not obvious (dragging, rotating, keyboard,
  touch), what feedback each action gets, and what is never allowed.
- **Small screens and accessibility** — what changes on a phone; keyboard access; contrast;
  what a screen reader announces for the key moments.
- **Coverage** — a table of every `AC-n` and the screen and state that shows it. An acceptance
  criterion no screen serves is either a gap in the design or a question.
- **Questions** and **Decisions**, as `PRODUCT.md` has them: at most seven questions, each with
  options, a recommendation and what it changes; the design is drawn as if each recommendation
  were accepted.

## 3. The mock-ups

One file per screen in `product/<ticket id>/mockups/`, named for it (`board.html`), each a
single, self-contained HTML file: inline CSS, no network, no build, so it opens from disk. Real
content, never lorem ipsum: a game mid-play, a list with eight plausible rows. Each shows the
screen's main state; add a second file for a state that looks very different (`board-game-over.html`).
`mockups/index.html` links them all with a line each. They are drawings, not the product: no
logic beyond what shows a state.

## 4. Hand it over

Add a `## Your turn` section to the ticket file: what was drafted and where; the questions that
matter most; and how to continue — open an interactive agent session in a checkout of this
repository and ask it to follow `## The conversation` in
`.baton/courses/build-app/legs/design.md` for this ticket, or edit the documents directly and
set the ticket's `answer:` to `design`. Do not set `answer:` yourself. Commit the documents and
the ticket file together, with explicit paths, to the default branch.

## The conversation

*This part is for the owner's interactive session, not for the headless leg above.* You are
helping the owner settle the design in `product/<ticket id>/DESIGN.md` and its mock-ups.

- Read the ticket, `PRODUCT.md`, `DESIGN.md` and the mock-ups. Ask the owner to open
  `mockups/index.html`; walk the core loop with them, screen by screen.
- Take the questions one at a time, recommendation first. Change the documents and the mock-ups
  after each answer, and record it under `## Decisions` as `- <decision> — the owner, <date>`.
  The owner should see each changed mock-up before the next question.
- If an answer changes the product (a criterion added, a rule changed), change `PRODUCT.md` too,
  and say so: the product definition stays the one source of what the software must do.
- When the questions are settled and every `AC-n` has a screen, ask whether the design is right.
  **Only on their yes:** remove the ticket's `## Your turn` section, set its `answer:` to
  `design`, commit the documents and the ticket together to the default branch, and push. That
  approval starts the `architect` leg.
- Do not start the architecture or any code in this session.
