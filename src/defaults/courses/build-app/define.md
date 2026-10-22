# build-app · define — draft the product definition

You are running the `define` leg of the `build-app` course. The ticket's file,
`$BATON_TICKET_FILE`, asks for an application or a feature, often in a sentence. When you finish,
`product/<ticket id>/PRODUCT.md` holds a draft product definition with its open questions, and the
ticket waits for the owner to refine and approve it. Baton's closing marker is written for you
after you return; do not write it.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84).

The owner's attention is the scarcest thing in this course. A blank page costs them an hour; a
draft with five pointed questions, each with a recommendation, costs them ten minutes. Do the work
that needs no owner, so that what reaches them is only what needs them.

## 1. Read first

- The whole ticket, and anything it links.
- **The repository.** If it already holds a product (code, a README, specs, earlier
  `product/*/` documents), this ticket is a feature of it: read enough to know what exists, and
  define the feature against it, never a second product beside it.
- **The domain.** If the request names something that exists (a game, a standard, a well-known
  tool), find out how it works: its rules, its edge cases, what people expect of it. Write down
  what you found and where; do not ask the owner what a source can answer.

## 2. Write `product/<ticket id>/PRODUCT.md`

In this order:

- **What it is** — three sentences: what it does, for whom, why they would use it.
- **Who it is for** — the people and their situation, one paragraph each, and the one whose
  needs win when they conflict.
- **The core loop** — what a person does, start to finish, on a good day.
- **Rules and behaviour** — everything the software must get right, written so a test could
  check it. For a game, the complete rules, including turn order, scoring, ending and the edge
  cases; for a tool, its inputs, outputs and the limits it enforces.
- **In scope / out of scope** — two lists. What is out is as important as what is in: say what
  a reasonable person would expect that this version will not do.
- **Acceptance criteria** — numbered `AC-1`, `AC-2`, …: each one observable behaviour a person
  or a browser test can check, with the input and the expected result. Every rule above is
  covered by at least one. Later legs trace tickets and tests back to these numbers.
- **Success** — how the owner will know it worked, a few lines.
- **Questions** — below.
- **Decisions** — empty for now; the conversation fills it.

## 3. The questions

A `## Questions` section, at most seven, ordered by consequence: the one that changes the most
of the document first. Each one:

```
### Q<n>. <one sentence the owner can answer>

- **Options:** (a) … · (b) … [· (c) …]
- **Recommendation:** (<letter>) — <why, one or two sentences>
- **Changes:** <the sections of this document the answer changes>
```

- Ask only what the owner alone can settle: who it is for, what is in or out, what matters
  most. Never what a source, the code or a quick test could settle.
- Write the document as if your recommendation were accepted, so it reads whole, and mark each
  assumption that rests on a question with `(Q<n>)`.

## 4. Hand it over

Add a `## Your turn` section to the ticket file:

- one line saying what was drafted, with the document's path;
- the two or three questions that matter most, by number and in one line each;
- how to continue: open an interactive agent session in a checkout of this repository and ask
  it to follow `## The conversation` in `.baton/courses/build-app/legs/define.md` for this
  ticket — or edit the document directly, and set the ticket's `answer:` to `define` when it is
  right.

Do not set `answer:` yourself. Commit `PRODUCT.md` and the ticket file together, with explicit
paths, to the default branch.

## The conversation

*This part is for the owner's interactive session, not for the headless leg above.* You are
helping the owner turn the draft `product/<ticket id>/PRODUCT.md` into the definition they want.

- Read the ticket, the draft and its sources first. Then start with the first question:
  recommendation first, the options after it, and what the answer changes. One question at a
  time; take the owner's answer, or their own idea, as it comes.
- After each answer, change the document at once: move the question to `## Decisions` as
  `- <decision> — the owner, <date>`, rewrite the sections it changes, and drop its `(Q<n>)`
  marks.
- The owner may change anything, not only the questions. When a change contradicts something
  else in the document, say so and ask which wins.
- Keep the acceptance criteria testable as the document changes: a criterion nobody could check
  is reworded or removed.
- When the questions are settled, read the owner the three-sentence summary and the acceptance
  criteria, and ask whether it is right. **Only on their yes:** remove the ticket's
  `## Your turn` section, set the ticket's `answer:` to `define`, commit the document and the
  ticket together to the default branch, and push. That approval starts the `design` leg.
- Do not start the design, the architecture or any code in this session.
