# AGENTS.md — Baton

Read the repository rules in [CLAUDE.md](CLAUDE.md) first. Baton tickets and their spec are
in this checkout; no entry-point skill or second checkout is needed.

## Work a ticket by hand

1. Read `baton board baton` or `baton ticket history baton:<ID>` before claiming. Continue the
   recorded station and existing PR or branch; a stale `status:` field does not restart a ticket.
   Do not work a ticket another runner holds.
2. Where git still owns the lock, use `node cli/baton.mjs tickets claim <ID>` (the legacy
   ticket helper; run `node cli/baton.mjs tickets --help` for its options). It accepts both
   `B-n` and imported `R3-NNNN` ids and takes the claim on the default branch. Do not edit the
   lock by hand or use `--offline` to bypass a live Baton.
3. Read the ticket and cited spec sections. Fetch, continue `claude/<ID>-*` if it exists, or
   create that branch from the default branch's tip. Implement and test the ticket, push, and
   open the PR with the id at the start of its title. Add its URL to `prs:`. Follow the local
   [implement instructions](.baton/courses/create-pr/legs/implement.md) for checks and PR format.
4. Another person or session reviews the pushed head; fix findings on the same branch. After
   the PR lands, the legacy `tickets done <ID>` records completion. To release work instead,
   use `tickets set <ID> available --note "<handoff>"`; keep the PRs so the next person continues.
   These git-lock writes are only for the legacy workflow, not for a runner's active claim.

## Run the course with Baton

On a host already configured for the repository, start
`baton run --home . --course create-pr`. Use `baton run` until the spec's `baton runner start`
spelling ships. For a local drill, use an isolated Baton and scratch repository/remote with a disposable ticket;
for a production drill, have the operator designate the ticket and grant the runner first.
Use the configured Baton URL and runner credential, not an owner or administrator key.

The runner takes the lease and drives each leg. Keep the pinned source's `course.json` and the
generated launchers in `.baton/courses/create-pr/`: the current CLI syncs only when the local
graph matches the pin. Use `.baton/courses/create-pr/legs/*.md` to customize the sessions. The launcher
sets `BATON_INSTRUCTIONS` and `BATON_TICKET_FILE`, and `BATON_ANSWER` when the leg has a
machine-read answer. Complete checks and subprocesses before exiting. Review prints `approve`
or `changes` on the last line (with the PR URL if needed). Baton, not the agent, advances or
releases the lease. Check the board and ticket history for the final station and the forge for
the merged PR; a PR on its own does not show that the course completed.

## The supervising agent

**This section is for the agent that supervises Baton's runners** — the session that checks the
runners, their legs and their PRs, and steps in when they cannot go on. An agent running a
ticket's leg (implement, run-tests, review, fix, merge) is not the supervisor: skip this
section, and never edit `docs/interventions.mdx` from a leg.

Baton is meant to run unattended. Every time it does not, record it:

- **Keep [docs/interventions.mdx](docs/interventions.mdx).** Append one entry for each
  intervention — anything you or the owner, through you, had to do before the runners could
  make progress: a retry or park answered, a PR merged or rebased by hand, a ticket closed or
  archived by hand, a revert, a re-run job, a course or setting changed, a workflow edited, a
  diagnosis the runners could not make themselves. Monitoring that finds nothing wrong is not
  an intervention.
- **Every entry gives** a UTC timestamp, the host, the ticket ids (or `none` and what it
  touched instead), why the intervention was needed, the resolution — what was actually
  done, with commits and PRs — and how Baton should handle the situation autonomously next
  time, naming the ticket that would build it or saying *no ticket yet*.
- **Write it in the same turn as the intervention**, or the next, while the evidence is in
  front of you. One cause is one entry, even across several tickets; a second occurrence of a
  known cause is a new entry that links the first.
- **When a fix lands**, mark the entries it covers *handled by B-n* (#PR). Never delete an
  entry.
- The page goes to main by pull request, like any other doc. Its MDX must compile
  (`npm run check:wiki`): code-like text such as `<sha>` goes in backticks.
- A surprise about how Baton behaves also gets a `docs/lessons.mdx` entry (CLAUDE.md, *Log
  what a run taught*). The interventions page counts the interventions; the lessons page keeps
  the understanding.
