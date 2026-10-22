#!/usr/bin/env bash
# start-runner.sh — start a Baton runner for this repository on the production Baton
# (baton.immediately.run) and let it work tickets: it heartbeats, claims the next available
# ticket and runs its legs through the agent_command .baton/baton.json names (today: a real
# `opencode run`), pushing branches and opening PRs until you stop it or --for elapses.
# The runbook is docs/runbooks/register-baton.mdx: the key (step 1), the grant (step 5).
#
# Usage: scripts/start-runner.sh [--home <checkout>] [--for 45m|2h|90s] [--session <name>]
#                                [--harness opencode|claude-code] [--capabilities a,b]
#                                [--url <https://…>] [--check] [--log <file>]
#
#   --home        the checkout the runner works in (default: this repository). One runner per
#                 checkout — a second runner needs its own clone (the script refuses a held one).
#   --for         stop gracefully after a duration (s, m or h; default: until Ctrl-C). Stopping
#                 is safe at any point: the runner releases its claim with a hand-off.
#   --check       run the preflight only and print what would start; nothing runs.
#
# Environment: BATON_KEY_FILE (or BATON_KEY / BATON_TOKEN) must name the worker key the owner
# granted — hostname and capabilities must match the grant (runbook step 5). BATON_HOSTNAME
# overrides the reported hostname; BATON_URL, BATON_REPOSITORY have defaults.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="$ROOT"
FOR=""
SESSION="run-$(date +%Y%m%d-%H%M%S)-$$"
HARNESS="opencode"
CAPABILITIES=""
URL="${BATON_URL:-}"         # empty: the CLI's default (production)
CHECK_ONLY=0
LOG=""

die() { echo "start-runner: $*" >&2; exit 2; }
note() { echo "start-runner: $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR="${2:?--home needs a path}"; shift 2 ;;
    --for) FOR="${2:?--for needs a duration}"; shift 2 ;;
    --session) SESSION="${2:?--session needs a name}"; shift 2 ;;
    --harness) HARNESS="${2:?--harness needs a name}"; shift 2 ;;
    --capabilities) CAPABILITIES="${2:?--capabilities needs a list}"; shift 2 ;;
    --url) URL="${2:?--url needs a URL}"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    --log) LOG="${2:?--log needs a path}"; shift 2 ;;
    *) die "unknown flag: $1 (see the header of this script)" ;;
  esac
done

# ---- preflight -------------------------------------------------------------
# §6.13: a leg session never claims. Run this from your own terminal, not from inside a
# baton leg (an agent shell carries BATON_PARENT) — the runner would refuse itself anyway.
[ -z "${BATON_PARENT:-}" ] || die "this shell is a baton leg session (BATON_PARENT is set): a leg never claims — run the script from your own terminal"

# The credential (§6.4): a worker key the owner granted, or a token.
if [ -n "${BATON_KEY_FILE:-}" ]; then
  [ -f "$BATON_KEY_FILE" ] || die "BATON_KEY_FILE ($BATON_KEY_FILE) does not exist — runbook step 5 makes one (ssh-keygen -t ed25519 -f ~/.ssh/baton_worker) and the owner grants it"
  CRED="BATON_KEY_FILE=$BATON_KEY_FILE"
elif [ -n "${BATON_KEY:-}" ]; then CRED="BATON_KEY"
elif [ -n "${BATON_TOKEN:-}" ]; then CRED="BATON_TOKEN"
else
  die "no credential: set BATON_KEY_FILE (~/.ssh/baton_worker; runbook step 5: ssh-keygen, then the owner runs 'node cli/baton.mjs owner grant baton --key worker.pub --hostname <hostname> --capabilities create-pr,llm-call,agent-venue --max-tier judgement')"
fi

[ -d "$HOME_DIR/.git" ] || [ -f "$HOME_DIR/.git" ] || die "$HOME_DIR is not a git checkout"
GIT_DIR="$(git -C "$HOME_DIR" rev-parse --absolute-git-dir)"

# The runner bundle is built from the checkout's current source on every start
# (scripts/baton-run.mjs), which needs esbuild — a devDependency. Importing it runs that
# build: the same thing `baton run` does first, so the preflight proves the run path.
[ -x "$ROOT/node_modules/.bin/esbuild" ] || die "esbuild is missing — run: npm ci (in $ROOT)"
node -e 'await import(process.argv[1])' "$ROOT/scripts/baton-run.mjs" >/dev/null 2>&1 || die "the runner bundle fails to build — run: npm ci (in $ROOT), and check: node scripts/baton-run.mjs"

# The settings the runner will read (B-83: the no-op echo is refused by baton run itself).
SETTINGS="$HOME_DIR/.baton/baton.json"
[ -f "$SETTINGS" ] || die "$HOME_DIR has no .baton/baton.json — run: node cli/baton.mjs repo init"
AGENT_COMMAND="$(node -e 'const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(typeof s.agent_command === "string" && s.agent_command !== "" ? s.agent_command : "echo")' "$SETTINGS")"
[ "$AGENT_COMMAND" != "echo" ] || die ".baton/baton.json names agent_command \"echo\" — the no-op stub: run: node cli/baton.mjs repo init --agent opencode"
AGENT_BIN="$(printf '%s' "$AGENT_COMMAND" | awk '{print $1}')"
command -v "$AGENT_BIN" >/dev/null 2>&1 || note "WARNING: '$AGENT_BIN' (the agent_command) is not on PATH — every leg would fail until it is (and authenticated)"

# One runner per home checkout (R-BTN-131): refuse a held one.
LOCK="$GIT_DIR/baton-runner.lock"
if [ -f "$LOCK" ]; then
  HOLDER="$(tr -d '[:space:]' <"$LOCK")"
  if [ -n "$HOLDER" ] && kill -0 "$HOLDER" 2>/dev/null; then
    die "$HOME_DIR is held by another runner (pid $HOLDER): each runner needs its own clone — pass --home <another clone>; if no runner is running there, remove $LOCK"
  fi
  note "a stale lock (pid ${HOLDER:-?}) is present; the runner takes it over"
fi

# The hostname must match the grant (runbook step 5) — BATON_HOSTNAME overrides.
HOSTNAME_REPORTED="${BATON_HOSTNAME:-$(hostname)}"
REPOSITORY="${BATON_REPOSITORY:-baton}"

# Legs run in the working tree: uncommitted changes are the leg's to trip over.
if [ -n "$(git -C "$HOME_DIR" status --porcelain 2>/dev/null | head -1)" ]; then
  note "WARNING: $HOME_DIR has uncommitted changes — legs run in this working tree; commit or stash first if you care"
fi

[ -n "$LOG" ] || LOG="$GIT_DIR/baton-runner-$SESSION.log"   # inside .git: never dirties the tree

# --for's duration, parsed once, before anything runs (so --check validates it too).
if [ -n "$FOR" ]; then
  if [[ "$FOR" =~ ^([0-9]+)(s|m|h)?$ ]]; then
    N="${BASH_REMATCH[1]}"; U="${BASH_REMATCH[2]:-s}"
    case "$U" in s) SECS=$((N)) ;; m) SECS=$((N*60)) ;; h) SECS=$((N*3600)) ;; esac
  else
    die "--for wants a duration like 45m, 2h or 90s (got: $FOR)"
  fi
fi

# ---- start -----------------------------------------------------------------
RUN_ARGS=(run --harness "$HARNESS" --home "$HOME_DIR" --session "$SESSION")
[ -n "$URL" ] && RUN_ARGS+=(--url "$URL")
[ -n "$CAPABILITIES" ] && RUN_ARGS+=(--capabilities "$CAPABILITIES")

note "credential:   $CRED"
note "url:          ${URL:-default (https://baton.immediately.run)}"
note "repository:   $REPOSITORY (course: what .baton/baton.json declares)"
note "home:         $HOME_DIR"
note "hostname:     $HOSTNAME_REPORTED  (must match the grant; BATON_HOSTNAME overrides)"
note "harness:      $HARNESS (fills in only when the settings name no agent_command)"
note "agent:        $AGENT_COMMAND"
note "session:      $SESSION"
note "log:          $LOG"
note "stop:         Ctrl-C (a graceful release with a hand-off)${FOR:+, or after $FOR}"

if [ "$CHECK_ONLY" = 1 ]; then
  note "--check: preflight passed; would run: node cli/baton.mjs ${RUN_ARGS[*]}"
  exit 0
fi

note "starting (the first log lines show the heartbeat — 'forbidden' there means the key, the"
note "hostname or the grant does not match, runbook step 5; the dashboard's Workers view shows"
note "the machine once it beats): follow along with:  tail -f \"$LOG\""

cd "$HOME_DIR"
# A shell launched from a leg would carry its BATON_* leg environment down to the agents;
# only the credential, the endpoints and the identity pass through.
env -u BATON_COURSE -u BATON_LEG -u BATON_INSTRUCTIONS -u BATON_TICKET_FILE \
    -u BATON_ANSWER -u BATON_VERDICT -u BATON_AGENT_COMMAND -u BATON_TAKEN \
    -u BATON_ADVICE -u BATON_STATE \
    ${URL:+BATON_URL="$URL"} BATON_REPOSITORY="$REPOSITORY" \
    BATON_HOSTNAME="$HOSTNAME_REPORTED" BATON_SESSION="$SESSION" \
    node "$ROOT/cli/baton.mjs" "${RUN_ARGS[@]}" >"$LOG" 2>&1 &
RUNNER=$!

# ---- the stalled-leg watch (the B-86 lesson, 2026-10-22) --------------------------------
# An agent can finish its work and never exit: every green signal stays green (the lease is
# fresh, the runner healthy, the process alive) while the leg waits forever on an exit that
# never comes. The signature that catches it: a leg older than LEG_STALL_MIN whose checkout —
# and any opencode worktree beside it — have been quiet longer than QUIET_MIN. Advice, never
# action: it prints a line; the human decides. Core's own answer is baton.stalled on a default
# timer (R-BTN-167) with R-BTN-90's deadlines, still §7's proposal; until it is built, this is
# the detector.
LEG_STALL_MIN="${LEG_STALL_MIN:-60}"
QUIET_MIN="${QUIET_MIN:-10}"
warned_leg=""
newest_change() {
  # Any file changed inside the quiet window, in the checkout or an agent worktree (.git holds
  # the runner's own state and log, so it is excluded).
  find "$HOME_DIR" "$HOME/.local/share/opencode/worktree" -type f -newermt "-${QUIET_MIN} minutes" \
    -not -path '*/.git/*' -print -quit 2>/dev/null | grep -q . && echo busy || echo quiet
}
watch_leg() {
  [ -d "$HOME/.local/share/opencode/worktree" ] || return 0
  local legpid agentpid elapsed
  legpid="$(pgrep -P "$RUNNER" 2>/dev/null | head -1)"
  [ -n "$legpid" ] || { warned_leg=""; return 0; }
  agentpid="$(pgrep -P "$legpid" 2>/dev/null | head -1)"
  [ -n "$agentpid" ] && legpid="$agentpid"
  elapsed="$(ps -o etimes= -p "$legpid" 2>/dev/null | tr -d ' ')"
  [ -n "$elapsed" ] && [ "$elapsed" -gt $((LEG_STALL_MIN * 60)) ] || return 0
  [ "$(newest_change)" = "quiet" ] || return 0
  if [ "$warned_leg" != "$legpid" ]; then
    note "WARNING: the leg's agent (pid $legpid) has run $((elapsed / 60)) minutes with no file change anywhere for ${QUIET_MIN}+ minutes — the finished-but-never-exited shape (B-86, 2026-10-22). The stub waits for its exit; the claim cannot advance. Check the agent, or stop the runner and take its PR."
    warned_leg="$legpid"
  fi
}
( while kill -0 "$RUNNER" 2>/dev/null; do watch_leg; sleep 60; done ) &
WATCH=$!

shutdown() {
  note "stopping the runner (pid $RUNNER) — it releases its claim with a hand-off and exits"
  kill -INT "$RUNNER" 2>/dev/null || true
}
trap shutdown INT TERM

if [ -n "$FOR" ]; then
  ( sleep "$SECS"; kill -INT "$RUNNER" 2>/dev/null || true ) &
  TIMER=$!
fi

set +e
wait "$RUNNER"
STATUS=$?
set -e
[ -z "${TIMER:-}" ] || kill "$TIMER" 2>/dev/null || true
[ -z "${WATCH:-}" ] || kill "$WATCH" 2>/dev/null || true
trap - INT TERM

note "the runner exited ($STATUS); the log is kept at $LOG"
note "start it again the same way to keep working tickets; the dashboard"
note "(https://baton.immediately.run) shows every claim, and the tickets carry their state."
exit "$STATUS"
