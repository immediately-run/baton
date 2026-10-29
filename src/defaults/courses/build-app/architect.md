# build-app · architect — decide the architecture and how it runs

You are running the `architect` leg of the `build-app` course. The ticket's file is
`$BATON_TICKET_FILE`; the owner approved `product/<ticket id>/PRODUCT.md` and
`product/<ticket id>/DESIGN.md`. When you finish, `product/<ticket id>/ARCHITECTURE.md` says how
the software is built, where it runs and how it is operated, and the ticket waits for the owner
to settle its decisions. Baton's closing marker is written for you after you return; do not write
it.

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

- Both approved documents, with their `## Decisions`. They say *what*; this leg says *how*, and
  reopens neither.
- **What already exists.** In a repository that holds a product, the architecture is mostly
  inherited: its language, framework, hosting, storage, auth and checks. Name what you inherit,
  with paths, and propose something new only where the feature needs it.
- **The constraints the repository states**: its README, its contributor or agent instructions,
  any platform rules. A design that breaks them is not an option.

## 2. Decide what the evidence settles; ask about the rest

Every question below gets an answer in `ARCHITECTURE.md`. Settle each one the evidence can
settle — a constraint that forces it, a convention the repository has, a measurement you can
take — and say why in a line. What only the owner can weigh (cost, lock-in, who may use it, how
much operations work they will carry) becomes a question.

- **Shape** — the parts (client, server, workers, stores) and what each owns, as a short list
  and one diagram in text.
- **Where it runs** — hosting for each part, and why there; the environments (local, preview,
  production); how a change reaches production.
- **State** — every piece of data the product keeps (from `PRODUCT.md` and `DESIGN.md`): where it
  lives, who may read and write it, how long it is kept, and what happens to it on a crash, a
  conflict or a lost connection. For anything shared live (a game with two players), say who is
  authoritative and how the others learn of a change.
- **Identity and access** — whether people sign in, how, and what an anonymous person may do;
  how a person is kept from acting as another; every secret the system holds and where.
- **Abuse and failure** — what a hostile or careless person can do (cheat, flood, scrape) and
  what stops each; what the product does when a dependency is down.
- **Operations** — how it is deployed, observed (logs, errors, the one number that says it is
  healthy) and paid for, with a rough monthly cost at the scale `PRODUCT.md` expects.
- **Testing** — the checks each change must pass (lint, types, unit, browser), and how the
  acceptance criteria are tested end to end: the tool, and where the tests live.
- **The walking skeleton** — the smallest end-to-end slice that proves the shape: deployed,
  tested, doing one real thing. It becomes the first ticket.

## 3. Write `product/<ticket id>/ARCHITECTURE.md`

The sections above, in that order; then **Questions** and **Decisions**, as the earlier documents
have them. Each question names its options with their costs (money, effort, lock-in, risk), a
recommendation, and what it changes. Write the document as if each recommendation were accepted.
Name every library and service you rely on, with the version or plan.

## 4. Hand it over

Add a `## Your turn` section to the ticket file: what was decided and what is left for the owner;
the questions that matter most; and how to continue — open an interactive agent session in a
checkout of this repository and ask it to follow `## The conversation` in
`.baton/courses/build-app/legs/architect.md` for this ticket, or edit the document directly and
set the ticket's `answer:` to `architect`. Do not set `answer:` yourself. Commit the document and
the ticket file together, with explicit paths, to the default branch.

## The conversation

*This part is for the owner's interactive session, not for the headless leg above.* You are
helping the owner settle `product/<ticket id>/ARCHITECTURE.md`.

- Read the ticket and all three documents. Start with a two-minute tour: the parts, where they
  run, where the data lives. Then the questions, one at a time, recommendation first, each
  option's cost in plain words.
- If the owner asks what something would take, check it — a price page, a limit, a quick
  prototype in a scratch directory — rather than guess, and say what you checked.
- Change the document after each answer, recording it under `## Decisions` as
  `- <decision> — the owner, <date>`. An answer that changes what the product does goes into
  `PRODUCT.md` too.
- When the questions are settled, ask whether the architecture is right. **Only on their yes:**
  remove the ticket's `## Your turn` section, set its `answer:` to `architect`, commit the
  documents and the ticket together to the default branch, and push. That approval starts the
  `plan` leg.
- Write no product code in this session; a scratch prototype is deleted when the question is
  answered.

Your work lands under the ticket's own `## architect` heading — write it if it is not there; the close checks it is.
