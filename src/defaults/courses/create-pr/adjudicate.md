# create-pr · adjudicate — the owner answers three failed reviews

No agent runs this leg. Three review rounds have run on the ticket's PRs, each asking for
changes, and the third pair of eyes is **yours** — the owner's — not another model's: nothing
is reproduced by an agent, and no claim runs while you have not answered. The ticket waits at
`reviewed`, listed under **Needs you**, asking:

> **3 failed reviews — manual review or start a 4th round?**

Read the three rounds' findings on the ticket's PRs (one per repository its `repos:` names,
besides this one), then answer by pushing one commit to the ticket's branch carrying exactly
one of these trailers (a trailer is a line `Key: value` in the last block of the commit
message):

- **`Baton-Adjudicated: merge`** — you reviewed it yourself and it merges: the ticket moves to
  `adjudicated` with `merge` ready.
- **`Baton-Adjudicated: owner`** — you take the change over by hand: the ticket parks, `merge`
  waiting on you, until you say otherwise.
- **`Baton-Adjudicated: round`** — start a 4th review round: the round runs once more, its run
  budget granted by the owner override that carries this answer (`baton`, the dashboard's
  ticket override — `runs: {leg: review, add: 1}`), so push the trailer **and** grant the run;
  a third refused round will come back here, and you may answer again.

For example:

```
git commit --allow-empty -m "adjudicate: one more round" -m "Baton-Adjudicated: round"
git push
```

A plain `git commit` trailer is the durable record; on a forge, the comment line
`<!-- baton:adjudicated merge -->` (or `owner`) is read as the same answer. An answer older
than the round's last verdict counts for nothing — answer after reading the third round.

## Do not

- Answer from the review summaries alone: read the findings the rounds left open.
- Grant a round without reading why the third refused — the gate's tests are green; the
  findings are the question.
