#!/usr/bin/env bash
# cloud-runner.sh — make this Claude Code cloud session the host of a Baton process-mode runner
# (B-115; BATON_SPEC §8.1: a host of kind `cloud` is a Claude Code cloud container, its key the
# environment secret BATON_KEY, every container heartbeating under BATON_HOSTNAME). A cloud
# container holds everything a process-mode runner needs (§8.3 R-BTN-107: a leg is a child
# process; the leg's agent is a headless `claude -p`) except the means to stay up — only the
# model in the session can keep the session alive. So the work splits by who can do it: this
# script is the deterministic half, whose checks pass or fail — preflight, then start
# `baton run --harness claude-code` detached and return. The hosting half — re-arming a watcher
# under the harness's 2-hour background-task cap, never doing a leg, stopping on request — is
# the skill that runs this script: skills/baton-cloud-runner/SKILL.md, linked into a consuming
# repository's .claude/skills/ from node_modules/@immediately-run/baton/skills/.
#
# Usage: scripts/cloud-runner.sh [--home <checkout>] [--check]
#
#   --home   the checkout the runner works in (default: the working directory). One runner per
#            checkout — `baton run` takes the checkout's lock (R-BTN-131) and refuses a second.
#   --check  run the preflight and print what would start; nothing runs, nothing is written.
#
# Environment (the cloud environment's secrets, §8.1; the owner registers the machine key and
# adds them — `baton runner register --token` is never run here: the container is reclaimed, and
# a key generated inside it with it, the ticket's Do not):
#   BATON_KEY or BATON_KEY_FILE   the registered machine key (BATON_KEY is the cloud spelling)
#   BATON_HOSTNAME               the name the key is registered under, shared by every container
#   CLAUDE_CODE_SESSION_ID       this session's id — the runner's session_name (R-BTN-3)
#   GH_TOKEN                     the GitHub write identity a leg's PRs and comments need
#                                (R-BTN-144 keeps forge credentials in a leg's environment)
#   BATON_URL                    the Baton instance (default: production)
#   CLOUD_RUNNER_CLAUDE_TIMEOUT_S  the `claude -p` probe's bound (default 120; the tests lower it)
#
# The capabilities the runner declares are only what this preflight checked — the `claude -p`
# probe is llm-call, the gh and push checks are create-pr — never `baton run`'s default
# declaration (the grant's, which names agent-venue): a cloud container holds no venue unless
# one is up, and a declared capability the container does not hold is a lie rule 4 lets a course
# believe. Nothing here prints BATON_KEY, BATON_KEY_FILE's contents or GH_TOKEN.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOME_DIR="$PWD"
CHECK_ONLY=0

die() { echo "cloud-runner: $*" >&2; exit 2; }
note() { echo "cloud-runner: $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR="${2:?--home needs a path}"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    *) die "unknown flag: $1 (see the header of this script)" ;;
  esac
done

# ---- preflight: every check names itself when it fails ----------------------------------
# §6.13: a leg session never claims — this script started from inside a leg (BATON_PARENT set)
# would be exactly that, and `baton run` refuses it anyway.
[ -z "${BATON_PARENT:-}" ] || die "this shell is a baton leg session (BATON_PARENT is set): a leg never claims — run the script from the session itself, not from inside a leg"

# The identity (§8.1): the credential, the hostname it is registered under, the session's name.
if [ -n "${BATON_KEY_FILE:-}" ]; then
  [ -f "$BATON_KEY_FILE" ] || die "BATON_KEY_FILE ($BATON_KEY_FILE) does not exist — the cloud environment's secret should name it (§8.1), or set BATON_KEY"
elif [ -z "${BATON_KEY:-}" ]; then
  die "no credential: set BATON_KEY (the cloud environment's secret, §8.1 — the owner registers the machine key and adds it) or BATON_KEY_FILE"
fi
[ -n "${BATON_HOSTNAME:-}" ] || die "BATON_HOSTNAME is not set — the name the key is registered under, shared by every container of this cloud environment (§8.1)"
SESSION="${CLAUDE_CODE_SESSION_ID:-}"
[ -n "$SESSION" ] || die "CLAUDE_CODE_SESSION_ID is not set — it is the runner's session_name (R-BTN-3: the harness's session id)"
[ -n "${HOME:-}" ] || die "HOME is not set — the runner's state and this script's pid and log live under \$HOME/.cache/immediately-run/baton"
case "$SESSION" in
  *[!A-Za-z0-9_.:-]*|'') die "CLAUDE_CODE_SESSION_ID is not a session_name (R-BTN-3: ^[A-Za-z0-9_.:-]{1,128}$)" ;;
esac
[ "${#SESSION}" -le 128 ] || die "CLAUDE_CODE_SESSION_ID is longer than a session_name's 128 characters (R-BTN-3)"

# The tools the preflight and the launch need (claude and gh are checked by their own probes).
for tool in git node timeout setsid; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not on PATH — the cloud container needs it"
done

# The CLI this script starts: a checkout runs cli/baton.mjs, the installed package dist/baton.mjs.
if [ -f "$ROOT/cli/baton.mjs" ]; then CLI="$ROOT/cli/baton.mjs"
elif [ -f "$ROOT/dist/baton.mjs" ]; then CLI="$ROOT/dist/baton.mjs"
else die "neither $ROOT/cli/baton.mjs (a checkout) nor $ROOT/dist/baton.mjs (the installed package) exists — run this from the package or a checkout of baton"
fi
node "$CLI" run --help >/dev/null 2>&1 || die "node cannot run $CLI (its 'run --help' failed) — the runner needs node >= 22.13 (package.json engines)"

# The home checkout: a clean clone of the registered repository — legs run in its working tree
# (R-BTN-131), so uncommitted changes are the next leg's to trip over.
[ -d "$HOME_DIR/.git" ] || [ -f "$HOME_DIR/.git" ] || die "home: $HOME_DIR is not a git checkout"
STATUS="$(git -C "$HOME_DIR" status --porcelain 2>&1)" || die "home: git cannot read $HOME_DIR ($STATUS)"
[ -z "$STATUS" ] || die "home: $HOME_DIR has uncommitted changes — legs run in this working tree; commit or stash first"
ORIGIN="$(git -C "$HOME_DIR" remote get-url origin 2>/dev/null)" || die "home: $HOME_DIR has no origin remote — a cloud runner works a clone of the registered repository"
REPOSITORY="${ORIGIN%.git}"; REPOSITORY="${REPOSITORY##*/}"
[ -n "$REPOSITORY" ] || die "home: origin's url ($ORIGIN) names no repository"
if [ -n "${BATON_REPOSITORY:-}" ] && [ "$BATON_REPOSITORY" != "$REPOSITORY" ]; then
  die "home: origin ($ORIGIN) is a clone of $REPOSITORY, but BATON_REPOSITORY names $BATON_REPOSITORY — the checkout and the registered repository differ"
fi

# The `claude -p` probe (llm-call): the session's own model login must answer a one-line probe
# within the bound — the same child shape every non-interactive leg runs (§8.3's harness command).
CLAUDE_TIMEOUT_S="${CLOUD_RUNNER_CLAUDE_TIMEOUT_S:-120}"
PROBE_STATUS=0
PROBE="$(timeout "$CLAUDE_TIMEOUT_S" claude -p 'Answer with the single word: ready' 2>/dev/null)" || PROBE_STATUS=$?
if [ "$PROBE_STATUS" -eq 124 ]; then
  die "claude: no answer to the probe within ${CLAUDE_TIMEOUT_S}s — the session's model login must answer 'claude -p' (this is the command every leg runs)"
elif [ "$PROBE_STATUS" -ne 0 ]; then
  die "claude: the probe failed (exit $PROBE_STATUS) — 'claude -p' must answer with the session's own model login and no setup"
fi
[ -n "$PROBE" ] || die "claude: the probe answered nothing — 'claude -p' must answer with the session's own model login and no setup"
CAPS="llm-call"
note "claude: the probe answered — declaring llm-call"

# The GitHub write identity (create-pr): gh authenticated, and git able to push to the home
# repository — what a leg's branches and PRs ride on. A dry-run to a scratch ref: nothing lands.
GH_STATUS=0
gh auth status >/dev/null 2>&1 || GH_STATUS=$?
[ "$GH_STATUS" -eq 0 ] || die "gh: 'gh auth status' failed (exit $GH_STATUS) — the environment's GH_TOKEN is the write identity a leg's PRs and comments need; the owner adds it as the environment's secret"
PUSH_STATUS=0
GIT_TERMINAL_PROMPT=0 timeout 60 git -C "$HOME_DIR" push --dry-run origin "HEAD:refs/baton/cloud-runner-preflight" >/dev/null 2>&1 || PUSH_STATUS=$?
[ "$PUSH_STATUS" -eq 0 ] || die "push: 'git push --dry-run' to origin's scratch ref failed (exit $PUSH_STATUS) — the runner's legs push branches to $ORIGIN; check the credential and the remote"
case ",$CAPS," in
  *,create-pr,*) : ;;
  *) CAPS="$CAPS,create-pr" ;;
esac
note "gh: authenticated, and a dry-run push to origin succeeded — declaring create-pr"

[ -n "$CAPS" ] || die "no capability survived the preflight — only what was checked is declared, and nothing was"

# ---- the pid and log this run owns (the skill's watcher reads both) ---------------------------
CACHE="$HOME/.cache/immediately-run/baton/cloud-runner"
LOG="$CACHE/runner.log"
PIDFILE="$CACHE/runner.pid"
if [ -f "$PIDFILE" ]; then
  OLD_PID="$(tr -d '[:space:]' <"$PIDFILE")"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    die "a cloud runner is already running (pid $OLD_PID, log $LOG) — stop it first (kill -TERM $OLD_PID; the skill does this on request)"
  fi
  note "replacing a stale pid file (pid ${OLD_PID:-?} is not running)"
fi

note "home:         $HOME_DIR (a clean clone of $ORIGIN)"
CRED="BATON_KEY (the cloud environment's secret)"
[ -z "${BATON_KEY_FILE:-}" ] || CRED="BATON_KEY_FILE ($BATON_KEY_FILE)"
note "credential:   $CRED"
note "hostname:     $BATON_HOSTNAME (must match the grant; every container of this environment shares it)"
note "session:      $SESSION (CLAUDE_CODE_SESSION_ID — the runner's session_name, R-BTN-3)"
note "repository:   $REPOSITORY"
note "capabilities: $CAPS (only what the preflight checked — never the grant's default)"
note "pid and log:  $PIDFILE / $LOG"

if [ "$CHECK_ONLY" = 1 ]; then
  note "--check: preflight passed; would run: node $CLI run --harness claude-code --home $HOME_DIR --repository $REPOSITORY --hostname $BATON_HOSTNAME --session $SESSION --capabilities $CAPS"
  exit 0
fi

# ---- start, detached (§8.3's runner as its own session; the skill's watcher keeps it company) --
# The runner is NOT the harness's background task — the 2-hour cap must never kill a leg in
# flight (the ticket's Do not) — so it leaves this process's session and outlives this script.
mkdir -p "$CACHE"
cd "$HOME_DIR"
# A shell launched from a leg would carry its BATON_* leg environment down to the runner; only
# the credential, the endpoints and the identity pass through (start-runner.sh's scrub).
setsid nohup env -u BATON_COURSE -u BATON_LEG -u BATON_INSTRUCTIONS -u BATON_TICKET_FILE \
    -u BATON_ANSWER -u BATON_VERDICT -u BATON_AGENT_COMMAND -u BATON_TAKEN \
    -u BATON_ADVICE -u BATON_STATE \
    node "$CLI" run --harness claude-code --home "$HOME_DIR" --repository "$REPOSITORY" \
    --hostname "$BATON_HOSTNAME" --session "$SESSION" --capabilities "$CAPS" \
    >"$LOG" 2>&1 </dev/null &
RUNNER=$!
echo "$RUNNER" >"$PIDFILE"

# An instant death (a bad flag, a missing module) is the operator's commonest failure: catch it
# here, with the log's last lines, rather than leaving a watcher to find a pid that never lived.
sleep 1
if ! kill -0 "$RUNNER" 2>/dev/null; then
  tail -n 20 "$LOG" >&2 || true
  rm -f "$PIDFILE"
  die "the runner died at once (pid $RUNNER) — its last log lines are above"
fi
note "the runner is pid $RUNNER, detached; the log's first lines show the heartbeat — 'forbidden' there means the key, the hostname or the grant does not match (runbook step 5)"
note "the session's skill (baton-cloud-runner) watches the pid and stops the runner on request"
