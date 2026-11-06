---
name: baton-cloud-runner
description: Host a Baton process-mode runner in this Claude Code cloud session — run the preflight script once, then keep a watcher background task re-armed below the harness's 2-hour cap, never doing a leg yourself, and stop the runner on request. Use when asked to host, run, watch or stop the Baton cloud runner from a cloud session.
---

# Hosting the Baton cloud runner

This session is a Claude Code cloud container; Baton calls that a `cloud` host (BATON_SPEC §8.1).
It can host a process-mode runner: a plain `baton run` process whose legs are headless
`claude -p` children, like any process-mode runner. The session's own part is only **hosting** —
starting it, keeping watch under the harness's 2-hour background-task cap, and stopping it. The
deterministic half (the preflight and the detached start) is the package's script:

```sh
bash node_modules/@immediately-run/baton/scripts/cloud-runner.sh --home <a clean checkout> [--check]
```

An operator links this skill into the repository once:
`ln -s ../../node_modules/@immediately-run/baton/skills/baton-cloud-runner .claude/skills/`.

## Before starting

- The environment must carry the owner's secrets: `BATON_KEY` (the registered machine key),
  `BATON_HOSTNAME` (the name it is registered under) and `GH_TOKEN` (the GitHub write identity
  the legs' PRs ride on), with `CLAUDE_CODE_SESSION_ID` naming this session. If one is missing,
  the script names it and exits — report that line, do not improvise a key.
- Never run `baton runner register --token` to make a key: the container is reclaimed, and the
  key with it. The key is the environment's secret, the owner's to place.

## Start

1. Run the script once with `--check`. It probes the key, `claude -p`, `gh`, a dry-run push and
   the checkout, and prints what it would start. Any failure exits non-zero naming itself —
   report the line and stop; a check that fails is not a thing to work around.
2. Then run it without `--check`. It starts `baton run --harness claude-code` **detached**
   (its own session, `setsid nohup`), writes the runner's pid and log under
   `~/.cache/immediately-run/baton/cloud-runner/` (`runner.pid`, `runner.log`) and returns.
3. Start the watcher below as a **background task** — never in the foreground, and never the
   runner itself as a background task: the harness kills a background task at its 2-hour cap,
   and a cap killing the runner kills a leg mid-flight.

The capabilities the runner declares are only what the script checked (`llm-call,create-pr`) —
never the grant's wider default. Do not widen them by hand.

## The watcher

Run as a background task (it exits on its own; the cap is the backstop, never the plan):

```sh
D="$HOME/.cache/immediately-run/baton/cloud-runner"; PID="$(cat "$D/runner.pid")"; \
for i in $(seq 1 200); do kill -0 "$PID" 2>/dev/null || { echo "gone"; tail -n 8 "$D/runner.log"; exit 0; }; sleep 30; done; \
echo "alive after 100 minutes"
```

200 × 30 s = 100 minutes, below the 2-hour cap. On each watcher exit, exactly one of:

- **`gone`** — the runner's pid is dead. The tail carries the runner's death line (R-BTN-72: a
  runner's death always leaves a line — its claim, its leg and its last beat). Report that one
  line to the user. Then: if this is the **second** death within the past hour, do **not**
  start the runner again — report both deaths and stop hosting. Otherwise (the user still wants
  the runner hosted) run the script once more and re-arm the watcher, noting the death time.
- **`alive after 100 minutes`** — re-arm: start the same watcher background task again. Nothing
  else to do; the runner heartbeats on its own.

Track the death times of this hosting run (the watcher's exit times that printed `gone`) so the
twice-in-an-hour rule is a fact, not an impression.

## Stopping, on the user's request

```sh
kill -TERM "$(cat "$HOME/.cache/immediately-run/baton/cloud-runner/runner.pid")"
```

Then wait for the pid to exit (poll `kill -0` — a SIGTERM drains: the current leg completes and
the claim ends at its boundary; give it minutes, not seconds), and report the log's last line.
Do not start it again unless asked.

## Never

- **Never do a leg yourself** — no claiming, advancing, ending or working a ticket from this
  session; the runner's `claude -p` children do that, one at a time. This session only hosts.
- **Never print or echo `BATON_KEY`, `BATON_KEY_FILE`'s contents or `GH_TOKEN`** — not in a
  probe, a debug line or a command that dumps the environment. Name the variable, never its
  value.
- Never run the runner as the harness's background task (the 2-hour cap), and never restart a
  runner that died twice in an hour.
