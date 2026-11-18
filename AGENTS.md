# AGENTS.md — Baton

The project's rules for every agent are in [CLAUDE.md](CLAUDE.md); read it first. This file
adds what applies to one role only.

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
