#!/usr/bin/env bash
# drill-compromise.sh — the B-125 compromised-runner drill: every command of
# docs/runbooks/compromised-runner.mdx executed as written, against a local Baton and a
# scratch GitHub repository, so the kill switch is rehearsed before it is needed.
#
# What it builds: a scratch directory (keys, a plain-git home with three tickets, a local
# Baton), a compromised runner key holding a claim, a tagged fleet runner holding another,
# an attack commit on the home and on the scratch GitHub repository (an expedited ticket, a
# CODEOWNERS edit, a stray file), a PR with a verdict comment, and a canary Actions secret.
# Then it runs the runbook: the key revoked and the board closed to machine keys, the bar
# and the release, the credentials listed (a sacrificial SSH key created and deleted in the
# runbook's own shape — the fleet's are never touched), the forge and git searched, the
# revert and the rotation, the bar lifted and a re-minted runner resuming the released
# ticket. Exit 0 is the drill passing.
#
# What it never does is what the runbook marks "a human": no production secret, no fleet
# credential, nothing on https://baton.immediately.run — the GitHub App key, the webhook
# secrets and the redeploy (runbook step 6) are printed, not run, and nothing touches the
# identity's real SSH keys or tokens beyond reading their list.
#
# Usage: scripts/drill-compromise.sh [--repo OWNER/NAME] [--local-only] [--port N] [--keep]
#                                    [--cli 'the baton CLI command']
#
#   --repo OWNER/NAME  the scratch GitHub repository the attack half uses (create one:
#                      `gh repo create OWNER/baton-compromise-drill --private`; delete it
#                      after). Without it, or with --local-only, the GitHub half is skipped
#                      with a line saying so and the local half must still pass.
#   --port N           the local Baton's port (default 8791)
#   --keep             keep the scratch directory (printed) for inspection
#   --cli              override the pinned release CLI (default: npx --yes @immediately-run/baton@0.1.3,
#                      the runbook's pin; B-138)
#
# Needs: this repository's checkout (node_modules installed — `npm ci --ignore-scripts`),
# Node 22+, git, and `gh` signed in with write on --repo's repository for the GitHub half.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8791
KEEP=0
LOCAL_ONLY=0
REPO=''
BATON="${BATON_CLI:-npx --yes @immediately-run/baton@0.1.3}"

die() { echo "drill: $*" >&2; exit 2; }
note() { echo; echo "── $* ──────────────────────────────────────────"; }
# Run one runbook command as written, showing it. EXPECT_REFUSAL=1 inverts the check: the
# command is a probe whose refusal IS the proof (the revoked key's beat, the barred claim).
run() {
  echo "+ $*"
  if [ "${EXPECT_REFUSAL:-0}" = 1 ]; then
    OUT="$(eval "$@" 2>&1)"; RC=$?
    if [ $RC -ne 0 ] || ! grep -qiE 'forbidden|barred|40[139]|conflict' <<<"$OUT"; then
      echo "$OUT"; echo "drill: expected a refusal here (exit $RC)" >&2; FAILED=1
    else
      echo "$OUT"
    fi
    EXPECT_REFUSAL=0
  else
    eval "$@" || FAILED=1
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?--repo needs OWNER/NAME}"; shift 2 ;;
    --local-only) LOCAL_ONLY=1; shift ;;
    --port) PORT="${2:?--port needs a number}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --cli) BATON="${2:?--cli needs a command}"; shift 2 ;;
    *) die "unknown flag: $1 (see the header of this script)" ;;
  esac
done

[ -d "$ROOT/node_modules/esbuild" ] || die "no node_modules in $ROOT — run npm ci --ignore-scripts first (the local Baton bundles with esbuild)"
[ -x "$(command -v node)" ] || die "node is required"
[ -x "$(command -v git)" ] || die "git is required"
if [ -n "$REPO" ]; then
  [ -x "$(command -v gh)" ] || die "--repo needs gh on PATH"
  gh api "repos/$REPO" -q .full_name >/dev/null 2>&1 || die "cannot read $REPO with gh — is gh signed in, and does the repository exist?"
fi

FAILED=0
WORK="$(mktemp -d "${TMPDIR:-/tmp}/baton-compromise-drill-XXXXXX")"
ORIGIN="http://127.0.0.1:$PORT"
BATON_PID=''
cleanup() {
  [ -n "$BATON_PID" ] && kill "$BATON_PID" 2>/dev/null
  if [ "$KEEP" = 1 ]; then echo; echo "drill: scratch kept at $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

note "0. scratch: keys, a plain-git home, a local Baton (runbooks/local-home.mdx)"
mkdir -p "$WORK/keys"
cd "$WORK/keys" || die "mktemp failed"
for k in admin owner sync runner1 runner2 runner3 second; do ssh-keygen -q -t ed25519 -f "drill_$k" -C "drill $k" -N '' || die "ssh-keygen failed"; done
node -e 'const {generateKeyPairSync}=require("node:crypto");const {privateKey}=generateKeyPairSync("ed25519");process.stdout.write(JSON.stringify(privateKey.export({format:"jwk"})))' > "$WORK/keys/signing-key.json" || die "the tenant signing key could not be made"

git init --bare -q -b main "$WORK/home.git" || die "git init failed"
git --git-dir="$WORK/home.git" config receive.denyNonFastForwards true
git --git-dir="$WORK/home.git" config receive.denyDeletes true
git clone -q "$WORK/home.git" "$WORK/home" || die "clone failed"
cd "$WORK/home" || die "clone failed"
run "$BATON repo init --course create-pr" || true
rm -rf .github   # a plain home runs no Actions
node -e 'const f=".baton/baton.json",j=JSON.parse(require("fs").readFileSync(f,"utf8"));j.baton_url=process.argv[1];j.ticket_prefix="DR";require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\n")' "$ORIGIN"
for n in 1 2 3; do
  printf -- '---\nid: DR-%s\ntitle: drill ticket %s\nstatus: available\ncourse: create-pr\nrepos: []\ndepends_on: []\n---\n\nDrill ticket %s — a plain body.\n\n## Status\n' "$n" "$n" "$n" > "tickets/DR-$n.md"
done
git add -A
git -c user.email=drill@example.invalid -c user.name=drill commit -q -m "drill home: scaffold and three tickets"
git push -q origin main || die "the home's first push failed"

node "$ROOT/scripts/start-local.mjs" --db "$WORK/baton.db" --port "$PORT" \
  --admin-keys "$WORK/keys/drill_admin.pub" --signing-key "$WORK/keys/signing-key.json" > "$WORK/baton.log" 2>&1 &
BATON_PID=$!
for _ in $(seq 1 40); do
  node -e "fetch('$ORIGIN/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
  sleep 1
done
node -e "fetch('$ORIGIN/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || { tail -5 "$WORK/baton.log"; die "the local Baton did not come up on $ORIGIN"; }
export BATON_URL="$ORIGIN"
echo "baton: serving $ORIGIN from $WORK/baton.db"

run "$BATON admin -i '$WORK/keys/drill_admin' repo add drill/home --id home --forge git --remote 'ssh://localhost$WORK/home.git' --default-branch main --owner-key '$WORK/keys/drill_owner.pub' --sync-key '$WORK/keys/drill_sync.pub' --cut-over"
run "$BATON owner -i '$WORK/keys/drill_owner' grant home --key '$WORK/keys/drill_runner1.pub' --hostname drill-compromised --capabilities agent-venue"
run "$BATON owner -i '$WORK/keys/drill_owner' grant home --key '$WORK/keys/drill_second.pub' --hostname drill-second --capabilities agent-venue"
run "$BATON owner -i '$WORK/keys/drill_owner' grant home --key '$WORK/keys/drill_runner2.pub' --hostname drill-fleet --capabilities agent-venue"
run "$BATON repo sync --root '$WORK/home' --sync-key '$WORK/keys/drill_sync'"
run "$BATON board -i '$WORK/keys/drill_owner' home"

# The drill's stand-in runners: heartbeats, claims and ends signed with each machine key, the
# way baton run signs them (cli/sign.mjs's SSHSIG, the one verifier shape). Worker 1 is the
# compromised machine (no tags — as baton run declares none today); worker 2 is the fleet
# (one tag, the runbook's TAG); worker 3 is the re-minted machine of step 5.
cat > "$WORK/worker.mjs" <<'EOF'
// worker.mjs — the drill's stand-in runner: one signed call at a time, its JSON on stdout.
import { createHash } from 'node:crypto';
import { signHeaders, signingKey } from 'file://ROOT/cli/sign.mjs';
const [url, keyFile, cmd, ...args] = process.argv.slice(2);
const key = signingKey(keyFile);
const secret = process.env.WSECRET || '';
async function call(method, path, body) {
  const full = new URL(path, url).toString();
  const text = body === undefined ? '' : JSON.stringify(body);
  const headers = { ...signHeaders({ method, url: full, body: text, key }), 'Content-Type': 'application/json' };
  if (secret) headers['X-Worker-Secret'] = secret;
  const res = await fetch(full, { method, headers, body: text === '' && method === 'GET' ? undefined : text });
  console.log(JSON.stringify({ status: res.status, json: await res.json().catch(() => ({})) }));
}
const hb = (hostname, tags) => ({
  hostname, session_name: 'drill', harness: 'opencode', kind: 'vm',
  capabilities: ['agent-venue'], tier_ceiling: 'critical', lease_timeout_s: 900,
  courses: [{ repository: 'home', course: 'create-pr', version: 1 }],
  ...(tags ? { tags: tags.split(',') } : {}),
  secret_hash: createHash('sha256').update(secret || 'none').digest('hex'),
});
if (cmd === 'beat') await call('POST', '/v1/runner/heartbeat', hb(args[0], args[1]));
else if (cmd === 'claim') await call('POST', '/v1/runner/claim', { request_id: `drill-${Date.now()}`, ticket_id: args[0] });
else if (cmd === 'ack') await call('POST', `/v1/runner/messages/${args[0]}/ack`, {});
else if (cmd === 'end') await call('POST', `/v1/runner/claims/${args[0]}/end`, { end_reason: args[1], reached: args[2], next: args[3] === '-' ? null : args[3] });
else { console.error('worker.mjs beat|claim|ack|end'); process.exit(2); }
EOF
sed -i "s|file://ROOT/|file://$ROOT/|" "$WORK/worker.mjs"
# One wrapper per machine, each with its own worker secret (R-BTN-14: the secret authenticates
# every call after the first heartbeat). Worker 1 is the compromised machine; worker 2 the
# fleet (the runbook's TAG); worker 3 the re-minted machine of step 5.
W1() { WSECRET=secret-a node "$WORK/worker.mjs" "$ORIGIN" "$WORK/keys/drill_runner1" "$@"; }
W2() { WSECRET=secret-b node "$WORK/worker.mjs" "$ORIGIN" "$WORK/keys/drill_runner2" "$@"; }
W3() { WSECRET=secret-c node "$WORK/worker.mjs" "$ORIGIN" "$WORK/keys/drill_runner3" "$@"; }
FP1="$(ssh-keygen -lf "$WORK/keys/drill_runner1.pub" | grep -o 'SHA256:[A-Za-z0-9+/]*')"
FP2="$(ssh-keygen -lf "$WORK/keys/drill_second.pub" | grep -o 'SHA256:[A-Za-z0-9+/]*')"
CLAIM_ID() { node -e 'try{const j=JSON.parse(process.argv[1]);process.stdout.write(String(j.json.claim_id??""))}catch{}' "$1"; }

# The compromise, before the runbook starts: both machines hold claims, and the identity has
# pushed to the home's main and (with --repo) to the scratch GitHub repository.
W1 beat drill-compromised >/dev/null || die "worker 1 could not register"
OUT1="$(W1 claim home:DR-1)"; grep -q '"claim_id"' <<<"$OUT1" || die "worker 1 could not claim home:DR-1"
W2 beat drill-fleet fleet:drill >/dev/null || die "worker 2 could not register"
CLAIM2="$(CLAIM_ID "$(W2 claim home:DR-2)")"
[ -n "$CLAIM2" ] || die "worker 2 could not claim home:DR-2"
SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cd "$WORK/home"
node -e 'const j=JSON.parse(require("fs").readFileSync(".baton/baton.json","utf8"));j.agent_command="echo drilled";require("fs").writeFileSync(".baton/baton.json",JSON.stringify(j,null,2)+"\n")'
sed -i 's/^tags: \[.*\]/tags: [EXPEDITE]/; s/^status: available/status: available\ntier: critical/' tickets/DR-1.md
git add -A
git -c user.email=gh-worker@immediately.run -c user.name=immediately-run-worker commit -q -m "attack: an agent_command edit and an expedited ticket"
git push -q origin main || die "the home attack push failed"
ATTACK_HOME_SHA="$(git rev-parse HEAD)"
echo "attack on the home: $ATTACK_HOME_SHA"
GITHUB_HALF=1
if [ -z "$REPO" ]; then GITHUB_HALF=0; fi
if [ "$GITHUB_HALF" = 1 ] && [ "$LOCAL_ONLY" = 0 ]; then
  git clone -q "https://github.com/$REPO.git" "$WORK/attack" || die "could not clone $REPO"
  cd "$WORK/attack" || die "could not clone $REPO"
  IDENTITY="$(gh api user -q .login)"
  git config user.name "$IDENTITY"
  git config user.email "$IDENTITY@users.noreply.github.com"
  [ -f README.md ] || echo "# scratch" > README.md
  mkdir -p tickets .github
  printf -- '---\nid: DR-9\ntitle: injected\nstatus: available\ntags: [EXPEDITE]\ntier: critical\n---\n\ninjected ticket\n' > tickets/DR-9.md
  echo "* @$IDENTITY" > .github/CODEOWNERS
  echo attack > ATTACK.md
  git add -A
  git commit -q -m "attack: an expedited ticket, a CODEOWNERS edit, a stray file"
  git push -q origin main || die "the GitHub attack push failed (is the scratch repository empty, with main unprotected?)"
  ATTACK_SHA="$(git rev-parse HEAD)"
  git checkout -q -b attack-branch
  echo "attack pr" > PR.md
  git add -A
  git commit -q -m "attack: a branch"
  git push -q origin attack-branch
  run "gh pr create -R '$REPO' --base main --head attack-branch --title 'attack: injected PR' --body drill"
  PR_N="$(gh pr list -R "$REPO" --state open --head attack-branch --json number --jq '.[0].number')"
  run "gh pr comment '$PR_N' -R '$REPO' --body '<!-- baton:verdict approve --> drilled verdict'"
  run "gh secret set DRILL_CANARY -R '$REPO' -b drill-old-value"
  echo "attack on $REPO: $ATTACK_SHA (PR #$PR_N) by $IDENTITY"
else
  echo "drill: --repo not given — the GitHub half of the runbook is skipped, the local half still runs"
fi
cd "$WORK"

note "runbook 1 — the key first: revoke, then close the board to machine keys"
run "$BATON admin -i '$WORK/keys/drill_admin' state"
run "$BATON owner -i '$WORK/keys/drill_owner' grants home"
run "$BATON owner -i '$WORK/keys/drill_owner' revoke home '$FP1'"
echo "+ the same cut, everywhere at once with an administrator key (a second compromised machine, '$FP2'):"
run "$BATON admin -i '$WORK/keys/drill_admin' revoke '$FP2'"
echo "+ the revoked machine's next heartbeat (within its beat, 2 min) is refused — the probe:"
EXPECT_REFUSAL=1 run "W1 beat drill-compromised"
run "$BATON owner -i '$WORK/keys/drill_owner' policy show home > '$WORK/policy.json'"
node -e 'const f=process.argv[1],j=JSON.parse(require("fs").readFileSync(f,"utf8"));j.policy.inputs.board=j.policy.inputs.board.filter(b=>b!=="machine");require("fs").writeFileSync(process.argv[2],JSON.stringify(j.policy,null,2)+"\n")' "$WORK/policy.json" "$WORK/policy-no-machine.json" || FAILED=1
BASE="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version||""))' "$WORK/policy.json")"
run "$BATON owner -i '$WORK/keys/drill_owner' policy diff home '$WORK/policy-no-machine.json'"
run "$BATON owner -i '$WORK/keys/drill_owner' policy set home '$WORK/policy-no-machine.json' --base '$BASE'"
run "$BATON blocked -i '$WORK/keys/drill_owner' home:DR-1"

note "runbook 2 — stop the fleet's hands: the bar, the release, nothing new claimed"
run "$BATON owner -i '$WORK/keys/drill_owner' bar home --course '*' --tag fleet:drill --applies claim+advance --release-holders --reason compromise-drill"
echo "waiting for the alarm's release (a minute) and the fleet runner's next beat…"
RELEASE_ID=''
for _ in $(seq 1 30); do
  OUT="$(W2 beat drill-fleet fleet:drill)"
  RELEASE_ID="$(node -e 'try{const j=JSON.parse(process.argv[1]);const m=(j.json.messages||[]).find(m=>m.kind==="release");process.stdout.write(m?String(m.id):"")}catch{}' "$OUT")"
  [ -n "$RELEASE_ID" ] && { echo "$OUT"; break; }
  sleep 5
done
[ -n "$RELEASE_ID" ] || { echo "drill: the release never reached the fleet runner" >&2; FAILED=1; }
[ -n "$RELEASE_ID" ] && run "W2 ack '$RELEASE_ID'"
[ -n "$RELEASE_ID" ] && run "W2 end '$CLAIM2' released:compromise-drill filed implement"
echo "+ nothing new is claimed while the bar stands — the probe:"
EXPECT_REFUSAL=1 run "W2 claim home:DR-3"
run "$BATON owner -i '$WORK/keys/drill_owner' grants home"

note "runbook 3 — cut the credentials (a human): the list runs, the revoke is a page"
if [ "$GITHUB_HALF" = 1 ] && [ "$LOCAL_ONLY" = 0 ]; then
  run "gh api user/keys -q '.[] | .id, .title, .last_used'"
  echo "+ the runbook's revoke shape, proven on a sacrificial key (the identity's real keys are never touched):"
  ssh-keygen -q -t ed25519 -f "$WORK/keys/sacrificial" -C "drill sacrificial" -N ''
  SAC_ID="$(gh api user/keys -f title='drill sacrificial' -f key="$(cat "$WORK/keys/sacrificial.pub")" -q .id)" || FAILED=1
  [ -n "${SAC_ID:-}" ] && run "gh api -X DELETE user/keys/'$SAC_ID'"
else
  echo "skipped: --repo not given (the settings pages are a human's either way)"
fi
echo "a human: the identity's SSH keys (github.com/settings/keys), its gh tokens (github.com/settings/tokens, /settings/applications), the slot's gateway virtual keys"

note "runbook 4 — find what changed: the forge and git, read directly"
cd "$WORK/home" || die "lost the home"
run "git -C '$WORK/home' log --since='$SINCE' --format='%h %ad %an %s' --date=iso -- .baton/ .github/workflows/ .claude/ CLAUDE.md AGENTS.md '**/goals/**' tickets/"
run "git -C '$WORK/home' log --since='$SINCE' -p -- tickets/ | grep -E '^(commit |[-+] *(id|status|tags|tier|depends_on|repos):)' || true"
run "$BATON admin -i '$WORK/keys/drill_admin' state"
run "$BATON ticket -i '$WORK/keys/drill_owner' history home:DR-2"
run "$BATON ticket -i '$WORK/keys/drill_owner' show home:DR-1"
if [ "$GITHUB_HALF" = 1 ] && [ "$LOCAL_ONLY" = 0 ]; then
  run "gh api 'repos/$REPO/commits?since=$SINCE&per_page=100' -q '.[] | .sha[0:8] + \" \" + .commit.author.date + \" \" + (.commit.message | split(\"\\n\")[0])'"
  run "gh api repos/$REPO/commits/'$ATTACK_SHA'/pulls -q '.[] | \"#\\(.number) by \\(.user.login)\"'"
  run "gh pr list -R '$REPO' --state all --json number,title,state,author --jq '.[] | \"\\(.number) \\(.state) \\(.title)\"'"
  run "gh api repos/$REPO/issues/'$PR_N'/comments -q '.[] | select(.user.login==\"$IDENTITY\") | .body' | grep '^<!-- baton:' || true"
else
  echo "skipped: the forge reads (no --repo)"
fi

note "runbook 5 — undo and resume: revert, rotate, re-mint, lift, sync, claim"
cd "$WORK/home" || die "lost the home"
git -c user.email=drill@example.invalid -c user.name=drill revert --no-edit "$ATTACK_HOME_SHA" || FAILED=1
git push -q origin main || FAILED=1
echo "+ reverted the home's attack commit ($ATTACK_HOME_SHA)"
if [ "$GITHUB_HALF" = 1 ] && [ "$LOCAL_ONLY" = 0 ]; then
  cd "$WORK/attack" || die "lost the attack clone"
  git checkout -q main
  git pull -q
  git checkout -q -b revert-attack
  git revert --no-edit "$ATTACK_SHA" || FAILED=1
  git push -q origin revert-attack || FAILED=1
  run "gh pr create -R '$REPO' --base main --head revert-attack --title 'revert the attack' --body 'the drill'"
  REVERT_PR="$(gh pr list -R "$REPO" --state open --head revert-attack --json number --jq '.[0].number')"
  run "gh pr close '$REVERT_PR' -R '$REPO'"
  run "gh secret set DRILL_CANARY -R '$REPO' -b '$(date +%s)-drill-new-value'"
  cd "$WORK"
fi
run "$BATON owner -i '$WORK/keys/drill_owner' grant home --key '$WORK/keys/drill_runner3.pub' --hostname drill-clean --capabilities agent-venue"
BAR_ID="$($BATON owner -i "$WORK/keys/drill_owner" grants home | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=(JSON.parse(s).bars||[])[0];process.stdout.write(b?String(b.id):"")})')"
[ -n "$BAR_ID" ] || { echo "drill: the bar in force was not listed" >&2; FAILED=1; }
[ -n "$BAR_ID" ] && run "$BATON owner -i '$WORK/keys/drill_owner' bar lift home '$BAR_ID'"
run "$BATON repo sync --root '$WORK/home' --sync-key '$WORK/keys/drill_sync'"
W3 beat drill-clean fleet:drill >/dev/null || FAILED=1
run "W3 claim home:DR-2"

note "runbook 6 and 7 — the server variant and the lesson (a human; printed, never run by a drill)"
echo 'a human, only if the server or the Cloudflare account is the compromised thing:
  rotate the GitHub App key, BATON_GITHUB_WEBHOOK_SECRET, BATON_FORGE_SECRETS,
  GITHUB_DISPATCH_TOKEN and BATON_ADMIN_KEYS (npx wrangler secret put NAME, fresh values),
  then redeploy a known-good commit (npx wrangler deployments list).
record it: one dated entry in docs/lessons.mdx — what happened, the evidence, one bold
  lesson, what changed.'

echo
if [ "$FAILED" = 0 ]; then
  echo "drill: PASS — every runnable command of the runbook executed as written$( [ "$GITHUB_HALF" = 1 ] && [ "$LOCAL_ONLY" = 0 ] && echo ", against $REPO" || echo " (the local half)")"
else
  echo "drill: FAIL — a command above did not do what the runbook says" >&2
  exit 1
fi
