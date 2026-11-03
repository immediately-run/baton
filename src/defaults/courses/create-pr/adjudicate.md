# create-pr · adjudicate — the owner answers three failed reviews

No agent runs this leg. Three review rounds have run on the ticket's PRs, each asking for
changes, and the third pair of eyes is **yours** — the owner's — not another model's: nothing
is reproduced by an agent, and no claim runs while you have not answered. The ticket waits at
`reviewed`, listed under **Needs you**, asking:

> **3 failed reviews — manual review or start a 4th round?**

Read the rounds' findings on the ticket's PRs (one per repository its `repos:` names, besides
this one — the Needs-you entry links the PR whose last round holds them), then answer through
Baton, with your owner key — the way Baton's own decisions are answered:

```
baton owner -i <your owner key> resolve <repository> <ticket> review-rounds-3 merge|owner|round
```

(`baton decision list` prints the line for you, with the decision's id.)

- **`merge`** — you reviewed it yourself and it merges: the ticket moves to `adjudicated` with
  `merge` ready.
- **`owner`** — you take the change over by hand: the ticket parks, `merge` waiting on you,
  until you say otherwise.
- **`round`** — start a 4th review round. The answer itself grants exactly one more `review`
  run beyond the course's three — there is no second step — and the round runs on the same
  head. If that round still asks for changes, you are asked again (`review-rounds-4`), and may
  answer again.

The answer counts only because your key gave it to Baton. A commit trailer, or a comment line
such as `<!-- baton:adjudicated merge -->`, answers nothing: anyone who can push could write it.

## Do not

- Answer from the review summaries alone: read the findings the rounds left open.
- Grant a round without reading why the third refused — the gate's tests are green; the
  findings are the question.
