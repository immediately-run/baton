#!/usr/bin/env node
// baton.mjs — `baton admin …` and `baton owner …` (BATON_SPEC §10.6 R-BTN-57/-58, R-BTN-66/-67):
// the one management path. Each command builds one request — `plan`, pure, so it is tested on its
// own — and signs it with the key `-i` names; Baton validates it with the functions of
// src/core/admin.ts on either host. Nothing here holds a rule of its own: a refusal is Baton's,
// printed as it came. `baton run` (§6.13 R-BTN-72) is the worker loop: it lives in src/runner
// (TypeScript, node-only), so scripts/baton-run.mjs bundles it first, the way start-local does.
//
//   baton key create FILE [--comment TEXT]     an API key (R-BTN-159), beside SSH keys: FILE for -i, FILE.pub its public line
//   baton admin -i KEY repo add <forge path> --owner-key PUB[,PUB…] [--id ID (default: the path's last segment)]
//                [--forge github|gitlab|gitea|git] [--remote URL] [--web-base URL] [--default-branch main]
//                [--sync-workflow PATH] [--mirror-workflow PATH] [--ci-identity none|github-actions|gitlab:<issuer>|gitlab-mirror:<issuer>]
//                [--sync-key PUB[,…]] [--mirror-key PUB[,…]] [--weight N] [--tiers a,b,c] [--cut-over]
//   baton admin -i KEY repo set ID [--weight N] [--tiers a,b,c] [--remote URL] [--web-base URL]
//                [--sync-workflow PATH|none] [--mirror-workflow PATH|none] [--ci-identity …]
//                [--add-owner-key PUB[,…]] [--add-sync-key PUB[,…]] [--add-mirror-key PUB[,…]] [--remove-sync-key FP[,…]]
//   baton admin -i KEY repo retire ID
//   baton admin -i KEY grant REPO --key PUB [--hostname H] --capabilities a,b [--max-tier T]
//   baton admin -i KEY probe add --key PUB --label L
//   baton admin -i KEY resource add NAME --scope account|service --schema FILE|JSON    (R-BTN-76)
//   baton admin -i KEY instance add NAME --serves a,b --repositories x,y
//   baton admin -i KEY capacity set <capability> <n> [--yes]                 (R-BTN-178)
//   baton admin -i KEY capacity set <capability> --clear [--yes]             (R-BTN-178)
//   baton admin -i KEY capacity list
//   baton admin -i KEY resource set INSTANCE (--available | --unavailable [--until ISO]) [--valid-for 1h] [--detail FILE|JSON]
//   baton blocked -i KEY TICKET                           baton blocked -i KEY --repository R --on KIND:REF [--transitive]
//                — why a ticket cannot move, or what waits on a ticket, a resource, a capability or a
//                decision (R-BTN-75); `--on decision:*` is every decision waiting on a person
//   baton admin -i KEY revoke FINGERPRINT                          baton admin -i KEY open
//   baton admin -i KEY state      — what the dashboard draws, as JSON, read with the key (B-118)
//   baton owner -i KEY grant REPO --key PUB [--hostname H] --capabilities a,b [--label L] [--max-tier T]
//   baton owner -i KEY revoke REPO FINGERPRINT
//   baton owner -i KEY owners REPO (--add PUB | --remove FINGERPRINT)
//   baton owner -i KEY sign [--message TEXT] [--repo DIR] -- <paths>…   (B-127: a commit signed
//                the way require_signed_control counts — git's gpg.format ssh, the SSHSIG
//                namespace `git`, the key -i names; plain `git commit -S` with git configured
//                for the key is exactly as good)
//   baton owner -i KEY verify-config REPOSITORY [--checkout DIR]   (B-127: the agent-configuration
//                verifier — refuses (exit 1, naming paths and commits) when the checkout's agent
//                configuration (.claude/**, every CLAUDE.md and AGENTS.md, .mcp.json, plugin
//                manifests) was last changed in a commit no owner key signed; the owner installs
//                it outside the repository, in user-level settings or the environment's setup)
//   baton owner -i KEY policy show REPO                     — the signed read (R-BTN-189), as JSON
//   baton owner -i KEY policy diff REPO FILE                — the knobs FILE's document would change
//   baton owner -i KEY policy log REPO [--after N]          — the append-only change log
//   baton owner -i KEY policy set REPO FILE --base N        — a compare-and-set on the version you read
//   baton owner -i KEY policy apply REPO PRESET --base N    — cooperative | protected | protected-signed | plain-git
//   baton owner -i KEY policy floor add REPO NAME --guarantees a,b [--remove-by human|owner]
//   baton owner -i KEY policy floor remove REPO NAME        (R-BTN-189: needs the floor's remove_by and approvers.policy)
//   baton owner -i KEY bar REPO --course C|'*' --tag T [--legs a,b] --applies claim|claim+advance
//                [--starts-at ISO] [--ends-at ISO] [--release-holders] --reason R
//   baton owner -i KEY bar lift REPO ID
//   baton owner -i KEY settings REPO [--required-bar LEG|'*' --course C|'*' [--except a,b] --tag-prefix P]… | --no-required-bars
//                             [--code-repos [<forge>:]<owner>/<name>[@<host>],… | none] [--forge-ids <repo id>,<owner id>]   (B-182, R-BTN-140)
//                             [--pushers <forge user id>[@<host>],… | none]                                                          (B-182, R-BTN-139)
//                [--retry 1h,4h --max-failed 3 | --retry default] [--transcript-repos a,b]
//                [--unblocked-workflow .github/workflows/F.yml | --unblocked-workflow none] [--remind-after 24h]
//                [--require-signed-control | --no-require-signed-control]   (B-127: control inputs
//                count only at commits an owner's human-only key signed; on tightens, off needs
//                an approvers.policy approver)
//   baton owner -i KEY courier add REPO --key PUB --asks owner[,…]      (R-BTN-80: a personal courier)
//   baton owner -i KEY courier revoke REPO FINGERPRINT
//   baton owner -i KEY resolve REPO TICKET baton:retries|baton:stalled retry|park   (R-BTN-78)
//   baton owner -i KEY resolve REPO TICKET DECISION OPTION   — a sync-posted decision's answer (B-110: review-rounds-3 round)
//   baton admin -i KEY repos                                         (B-90: the registry — one signed request, one JSON answer)
//   baton owner -i KEY grants REPO                    (B-90: the repository's owners, grants and settings, and the bars in force)
//   baton board -i KEY REPO                    (B-90: the dashboard's view of one repository — its courses, head, mode, ready tickets)
//   baton run [--home <checkout>] [--repository ID] [--course ID] [--capabilities a,b] [--beat-every MS]
//             [--harness opencode|claude-code] [--verbose]   (R-BTN-72: the worker loop)
//   baton ticket -i KEY history TICKET [--before ID] [--limit N]                    (R-BTN-81)
//   baton decision list -i KEY [--watch | --all]
//                — the CLI courier (R-BTN-80): claims the key's notices, prints them as text and
//                marks them sent; --watch asks once a minute; --all lists every open decision it delivers
//   baton decision answer -i KEY <repository>:<id> <option> [--ref REF]
//                — a person's answer to the ticket's queued person leg, a std:decision@1 (R-BTN-116);
//                signed with an owner key of the repository or a human-only key; --ref names the
//                answer for idempotence when it rode a commit (R-BTN-39)
//
//   baton repo sync [--root DIR] [--url URL] [--latest BRANCH] [--facts FILE] [--sync-key FILE] [--busy-retry S]
//   baton repo init [--course C] [--agent opencode|claude-code] [--agent-command CMD] [--override LEG]…
//   baton repo migrate-markers [--root DIR]   — the one-time fold of the retired .baton/markers.jsonl into the tickets (B-100)
//                   [--eject tickets|stations] [--pin owner/name@commit] [--force]
//                — a repository's own sync and scaffold (§2f R-BTN-74, R-BTN-131)
//   baton tickets new --title T [--description D] [--project ID] [--depends-on A,B] [--tags X,Y]
//                [--tier T] [--order N] [--repos a,b] [--course C] [--body-file F] [--trust T] [--invariants I]
//                — file one ticket, the next free id under .baton/baton.json's ticket_prefix,
//                with the conventional body, as one commit pushed to the default branch (B-112)
//   baton tickets claim <id> [-i KEY] [--url URL] [--offline] [--rules-reread <ids>]
//   baton tickets set <id> <status> [--pr URL] [--note TEXT] [-i KEY] [--url URL] [--offline] [--rules-reread <ids>] | done <id> [--pr URL]
//                — claim asks Baton first (B-129): before it writes, it reads the ticket from
//                Baton with the key -i names (else BATON_KEY_FILE) — the board for the station,
//                the ready leg and the live claims, the history for the path and the PRs of the
//                ended claims, the branch-holder query for the branch — and continues the ticket
//                where Baton holds it: past its course's start, a false `available` is a takeover
//                (the PRs are written back, the position printed), never a fresh start, while the
//                git lock and a parked or closed status still refuse; another claim refuses,
//                naming its holder and its lease; an unanswered read or an unreadable key refuses
//                rather than trust the frontmatter, unless --offline. set/done write any live
//                status, each one commit pushed to the default branch (B-112); a release
//                (set <id> available) keeps every prs: entry and its commit is the hand-off — the
//                PRs, Baton's station and next leg, the branch and --note's what is left (B-129);
//                claim refuses a ticket citing a rule the spec's history amended since the ticket
//                was filed or last re-read it, until --rules-reread names those ids (R-BTN-74)
//   baton tickets check [--repo DIR] [--quiet]
//                — check this repository's ticket source without posting it: ids, the board
//                post's validation, depends_on targets and cycles, (with check.depends_line in
//                .baton/baton.json) each **Depends on:** line, (with check.sections_since) the
//                ### Trust and ### Invariants sections (with check.sections_from_id, the _filed
//                line from that id on), and the generated "How tickets work" page;
//                exit 1 naming every finding (B-111, B-112); live tickets citing a rule amended
//                since they were filed are listed, never a finding (R-BTN-74)
//   baton tickets --help
//                — the commands, the tags Baton reads and their meanings, the Requires: clause (B-112)
//   baton request "<one sentence>" --course C [--repo DIR] [--tier T] [--branch B] [--remote R]
//                — start a course from one sentence, no hand-written ticket (B-98, R-BTN-131):
//                files ONE request ticket (the sentence as title and description, course: C,
//                status available, tags [request], the next free id under the repository's own prefix) as one commit pushed
//                straight to the repository's default branch — --branch, else the checkout's
//                origin/HEAD, else main — retrying on a moved head. It is a REPOSITORY command,
//                not an API call: the push triggers the sync, the board places the ticket, and
//                the next claim starts C. C's .baton/courses/C/course.json must say
//                starts_from: request (create-spec, build-app), and .baton/baton.json must list
//                it; an ordinary course keeps its hand-filed tickets.
//
//   baton test-course <repository root> <course> [--base REF] [--board FILE]
//                — the course test kit (§2d, R-BTN-64/-65; R3-1248): the working tree's .baton/ is
//                the proposal, REF's the course in force (default: origin/HEAD, else origin/main;
//                none resolving is an error — `--base none` skips the removal rule on purpose),
//                FILE a board payload placing the live tickets. Runs a local Baton; needs no URL or key.
//
// The URL is `--url`, else BATON_URL, else https://baton.immediately.run.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestCredential, signHeaders, signingKey } from './sign.mjs';

export const DEFAULT_URL = 'https://baton.immediately.run';
/** The package the pinned release command names (B-138): `npx --yes @immediately-run/baton@<version>`. */
export const PINNED_PACKAGE = '@immediately-run/baton';
const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** argv after the command: flags (each `--name value`, or a bare boolean) and positionals. The
 *  `--required-bar` groups keep their order, so each takes the flags that follow it. With
 *  `allowed`, a flag the command does not take is refused — never silently dropped (round 3, 3-A-1). */
export function parseArgs(argv, booleans = [], allowed = null, positionals = Infinity) {
  const flags = {};
  const positional = [];
  const groups = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') && a !== '-i') {
      // A command's own flags are refused misspelled with one dash or a typographic dash, and a
      // positional it does not take is refused — never silently dropped (round 3, 3-A-1, adjudicated).
      if (allowed && /^[-\u2010-\u2015\u2212]/.test(a)) throw new Error(`${a}: not a flag of this command (flags are --name)`);
      if (positional.length >= positionals) throw new Error(`${a}: this command takes no further argument`);
      positional.push(a);
      continue;
    }
    const name = a === '-i' ? 'identity' : a.slice(2);
    if (allowed && !allowed.includes(name) && !booleans.includes(name)) throw new Error(`${a}: not a flag of this command`);
    if (booleans.includes(name)) {
      flags[name] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${a} needs a value`);
    if (name === 'required-bar') groups.push({ leg: value });
    else if (groups.length && ['course', 'except', 'tag-prefix'].includes(name) && flags['required-bar-mode']) groups.at(-1)[name] = value;
    else flags[name] = value;
    if (name === 'required-bar') flags['required-bar-mode'] = true;
  }
  delete flags['required-bar-mode'];
  return { flags, positional, groups };
}

const list = (v) => (v == null ? undefined : String(v).split(',').map((x) => x.trim()).filter(Boolean));
const need = (v, what) => {
  if (v == null || v === '') throw new Error(`${what} is required`);
  return v;
};
const time = (v, what) => {
  if (v == null) return undefined;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new Error(`${what}: not a date (${v})`);
  return t;
};
export function duration(v) {
  const m = /^(\d+)([mhd])$/.exec(v);
  if (!m) throw new Error(`a duration is like 30m, 1h or 2d, not ${v}`);
  return Number(m[1]) * UNITS[m[2]];
}

/** The version of the package this CLI ships in — the pin the B-138 refusal names. `cli/` reads
 *  the checkout's package.json, the bundled `dist/` the package's own; null when neither reads. */
function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** B-138: the git working tree that owns the CLI's code — the directory holding the `.git` the
 *  CLI sits below — or null when no tree owns it (an npm install, npx's cache: a released copy,
 *  whose code no push changes). A checkout's `cli/` and a `dist/` built inside one are working
 *  trees: their code is what a push (a branch a leg checks out) leaves there. A `.git` above a
 *  `node_modules` boundary does not own the code below it — npm laid that down, no branch of
 *  the outer tree does (round 1, the dotfiles `$HOME`: a released copy installed under a `$HOME`
 *  that is itself a git repository is still a released copy). */
export function workingTreeOf(cliFile = fileURLToPath(import.meta.url)) {
  for (let dir = dirname(cliFile), parent = dirname(dir), base = basename(dir);; dir = parent, parent = dirname(dir), base = basename(dir)) {
    if (base === 'node_modules') return null;   // npm's boundary: no tree above it owns this code
    if (existsSync(join(dir, '.git'))) return dir;
    if (parent === dir) return null;
  }
}

/** A word that keeps the shell it is copied into reading one argument (round 1): the refusal's
 *  suggested command must survive a key path with a space in it. */
const sh = (v) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(v) ? v : `'${v.replaceAll("'", `'\\''`)}'`);

/** The B-138 refusal: the pinned command for the same argv, so the operator copies it. */
function workingTreeRefusal(argv) {
  const version = packageVersion();
  return `an owner or administrator key runs a released CLI only — this one runs from the git working tree at ${workingTreeOf()}, whose code a push changes (B-138). Run the pinned release instead: npx --yes ${PINNED_PACKAGE}@${version ?? '<version>'} ${argv.map(sh).join(' ')} — or pass --dev to override, for this checkout's own development`;
}

/** Where `--dev` sits as this guard's flag, not as a flag *value* (round 1): `--capabilities
 *  --dev` is the capability string "--dev", not the override — stripping it would bypass this
 *  guard and mangle the command. A `--dev` right after a flag that takes a value is that value;
 *  the owner and administrator commands' value-less flags (parseArgs booleans) are named here so
 *  `--yes --dev` still counts. An unknown boolean is read as value-taking, which refuses rather
 *  than bypasses — the safe direction. */
const NO_VALUE_FLAGS = new Set(['transitive', 'cut-over', 'available', 'unavailable', 'clear', 'yes', 'release-holders', 'no-required-bars', 'require-signed-control', 'no-require-signed-control', 'watch', 'all']);
function devFlagPositions(argv) {
  const at = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--') break;   // `owner sign … -- <paths>`: everything after is a path
    if (argv[i] !== '--dev') continue;
    const prev = argv[i - 1];
    const name = prev === '-i' ? 'identity' : prev === '-m' ? 'message' : prev.startsWith('--') ? prev.slice(2) : null;
    if (name != null && !NO_VALUE_FLAGS.has(name)) continue;   // the previous flag eats this one
    at.push(i);
  }
  return at;
}

/**
 * The request a command makes: `{method, path, body}`. `readKey(path)` reads a public key file
 * (or returns the argument when it is a key line itself). Pure: no network, no signing.
 */
export function plan(role, argv, readKey = (p) => (/^(ssh|sk|ecdsa)-/.test(p) ? p : readFileSync(p, 'utf8').trim()), readJson = (p) => readFileSync(p, 'utf8')) {
  const [cmd, ...rest] = argv;
  if (role === 'blocked') {
    // R-BTN-75: a GET any key granted on the repository, an owner of it or an administrator signs.
    const { flags, positional } = parseArgs(argv, ['transitive'], ['on', 'repository'], 1);
    if (flags.on) {
      if (positional.length) throw new Error('baton blocked --on KIND:REF takes no ticket');
      const q = new URLSearchParams({ on: flags.on, ...(flags.transitive ? { transitive: '1' } : {}) });
      return { method: 'GET', path: `/v1/repositories/${encodeURIComponent(need(flags.repository, '--repository (with --on)'))}/blocked?${q}` };
    }
    const ticket = need(positional[0], 'the ticket, <repository>:<id>');
    const i = ticket.indexOf(':');
    if (i < 1) throw new Error('the ticket is <repository>:<id>');
    return { method: 'GET', path: `/v1/repositories/${encodeURIComponent(ticket.slice(0, i))}/tickets/${encodeURIComponent(ticket.slice(i + 1))}/blocks` };
  }
  if (role === 'ticket') {
    // R-BTN-81: a ticket's history, newest first — signed by an owner, an administrator or a key
    // granted on its repository, the principals of its blocks.
    if (cmd !== 'history') throw new Error('baton ticket history TICKET [--before ID] [--limit N]');
    const { flags, positional } = parseArgs(rest, [], ['before', 'limit'], 1);
    const ticket = need(positional[0], 'the ticket, <repository>:<id>');
    const i = ticket.indexOf(':');
    if (i < 1) throw new Error('the ticket is <repository>:<id>');
    const q = new URLSearchParams({ ...(flags.before ? { before: flags.before } : {}), ...(flags.limit ? { limit: flags.limit } : {}) });
    return { method: 'GET', path: `/v1/repositories/${encodeURIComponent(ticket.slice(0, i))}/tickets/${encodeURIComponent(ticket.slice(i + 1))}/history${q.size ? `?${q}` : ''}` };
  }
  if (role === 'board') {
    // B-90: the board of one repository, as the dashboard reads it — a GET any key granted on the
    // repository, an owner of it or an administrator signs.
    parseArgs(argv, [], [], 1);
    return { method: 'GET', path: `/v1/repositories/${encodeURIComponent(need(cmd, 'the repository id'))}/board` };
  }
  if (role === 'admin') {
    if (cmd === 'repos') {
      // B-90: the registry, read-only.
      parseArgs(rest, [], [], 0);
      return { method: 'GET', path: '/v1/admin/repositories' };
    }
    if (cmd === 'repo') {
      const [sub, target, ...more] = rest;
      if (sub === 'add') {
        const { flags } = parseArgs(more, ['cut-over'], ['id', 'forge', 'remote', 'web-base', 'default-branch', 'sync-workflow', 'mirror-workflow', 'ci-identity',
          'sync-key', 'mirror-key', 'weight', 'tiers', 'owner-key'], 0);
        const path = need(target, 'the repository (its forge path, owner/name)');
        const keys = [...(list(flags['sync-key']) ?? []).map((k) => ({ public_key: readKey(k), role: 'sync' })), ...(list(flags['mirror-key']) ?? []).map((k) => ({ public_key: readKey(k), role: 'mirror' }))];
        return { method: 'POST', path: '/v1/admin/repositories', body: {
          id: flags.id ?? path.split('/').at(-1).toLowerCase(), github: path, default_branch: flags['default-branch'] ?? 'main',
          ...(flags.forge ? { forge: flags.forge } : {}), ...(flags.remote ? { remote: flags.remote } : {}), ...(flags['web-base'] ? { web_base: flags['web-base'] } : {}),
          ...(flags['sync-workflow'] ? { sync_workflow: flags['sync-workflow'] } : {}), ...(flags['mirror-workflow'] ? { mirror_workflow: flags['mirror-workflow'] } : {}),
          ...(flags['ci-identity'] ? { ci_identity: ciIdentity(flags['ci-identity']) } : {}), ...(keys.length ? { sync_keys: keys } : {}),
          ...(flags.weight ? { weight: Number(flags.weight) } : {}), ...(flags.tiers ? { tiers: list(flags.tiers) } : {}), ...(flags['cut-over'] ? { cut_over: true } : {}),
          owner_keys: need(list(flags['owner-key']), '--owner-key').map(readKey),
        } };
      }
      if (sub === 'set') {
        const { flags } = parseArgs(more, [], ['weight', 'tiers', 'remote', 'web-base', 'sync-workflow', 'mirror-workflow', 'ci-identity',
          'add-owner-key', 'add-sync-key', 'add-mirror-key', 'remove-sync-key'], 0);
        const add = [...(list(flags['add-sync-key']) ?? []).map((k) => ({ public_key: readKey(k), role: 'sync' })), ...(list(flags['add-mirror-key']) ?? []).map((k) => ({ public_key: readKey(k), role: 'mirror' }))];
        const workflow = (v) => (v === 'none' ? null : v);
        const body = {
          id: need(target, 'the repository id'), ...(flags.weight ? { weight: Number(flags.weight) } : {}), ...(flags.tiers ? { tiers: list(flags.tiers) } : {}),
          ...(flags.remote ? { remote: flags.remote } : {}), ...(flags['web-base'] ? { web_base: flags['web-base'] } : {}),
          ...(flags['sync-workflow'] ? { sync_workflow: workflow(flags['sync-workflow']) } : {}), ...(flags['mirror-workflow'] ? { mirror_workflow: workflow(flags['mirror-workflow']) } : {}),
          ...(flags['ci-identity'] ? { ci_identity: ciIdentity(flags['ci-identity']) } : {}),
          ...(flags['add-owner-key'] ? { owner_keys_add: list(flags['add-owner-key']).map(readKey) } : {}), ...(add.length ? { sync_keys_add: add } : {}),
          ...(flags['remove-sync-key'] ? { sync_keys_remove: list(flags['remove-sync-key']) } : {}),
        };
        if (Object.keys(body).length === 1) throw new Error('baton admin repo set ID names at least one change');
        return { method: 'POST', path: '/v1/admin/repositories', body };
      }
      if (sub === 'retire') {
        parseArgs(more, [], [], 0);
        return { method: 'POST', path: '/v1/admin/repositories', body: { id: need(target, 'the repository id'), retire: true } };
      }
      throw new Error('baton admin repos | baton admin repo add|set|retire');
    }
    if (cmd === 'grant') {
      const { flags, positional } = parseArgs(rest, [], GRANT_FLAGS, 1);
      return { method: 'POST', path: '/v1/admin/grants', body: grantBody(flags, readKey, { repository: need(positional[0], 'the repository id') }) };
    }
    if (cmd === 'probe' && rest[0] === 'add') {
      const { flags } = parseArgs(rest.slice(1), [], ['key', 'label', 'instances'], 0);
      return { method: 'POST', path: '/v1/admin/probes', body: { public_key: readKey(need(flags.key, '--key')), label: need(flags.label, '--label'), instances: list(flags.instances) ?? [] } };
    }
    if (cmd === 'revoke') {
      parseArgs(rest.slice(1), [], [], 0);
      return { method: 'POST', path: `/v1/admin/keys/${encodeURIComponent(need(rest[0], 'the key fingerprint'))}/revoke`, body: {} };
    }
    if (cmd === 'open') {
      parseArgs(rest, [], [], 0);
      return { method: 'POST', path: '/v1/admin/login-links', body: {} };
    }
    if (cmd === 'state') {
      // B-118: the dashboard's state, read with the key — no session, no Access login.
      parseArgs(rest, [], [], 0);
      return { method: 'GET', path: '/v1/admin/state' };
    }
    if (cmd === 'resource' && rest[0] === 'add') {
      // R-BTN-76 (B-168): two scopes — `account` and `service`; a runner's instances are its
      // repository's, never one it declares.
      const { flags, positional } = parseArgs(rest.slice(1), [], ['scope', 'schema'], 1);
      if (!flags.scope) throw new Error('baton admin resource add NAME names its --scope (account or service, R-BTN-76)');
      if (flags.scope === 'worker' || flags.scope === 'host') throw new Error(`--scope ${flags.scope} is retired: a resource is account or service, and a runner uses its repository's instances (R-BTN-76, B-168)`);
      if (flags.scope !== 'account' && flags.scope !== 'service') throw new Error('--scope must be account or service (R-BTN-76)');
      return { method: 'POST', path: '/v1/admin/resources', body: { name: need(positional[0], 'the resource name'), scope: flags.scope, detail_schema: jsonArg(need(flags.schema, '--schema'), readJson) } };
    }
    if (cmd === 'resource' && rest[0] === 'set') {
      // R-BTN-76: an administrator's reading by hand — one more instrument's, in force at most 24 hours.
      const { flags, positional } = parseArgs(rest.slice(1), ['available', 'unavailable'], ['until', 'valid-for', 'detail'], 1);
      if (!!flags.available === !!flags.unavailable) throw new Error('baton admin resource set INSTANCE names one of --available or --unavailable');
      if (flags.until && !flags.unavailable) throw new Error('--until is for an --unavailable instance');
      return { method: 'POST', path: '/v1/admin/readings', body: { readings: [{
        instance: need(positional[0], 'the instance'), available: !!flags.available,
        ...(flags.until ? { until: time(flags.until, '--until') } : {}), ...(flags['valid-for'] ? { valid_for: Math.round(duration(flags['valid-for']) / 1000) } : {}),
        ...(flags.detail ? { detail: jsonArg(flags.detail, readJson) } : {}),
      }] } };
    }
    if (cmd === 'instance' && rest[0] === 'add') {
      const { flags, positional } = parseArgs(rest.slice(1), [], ['serves', 'repositories'], 1);
      return { method: 'POST', path: '/v1/admin/instances', body: { name: need(positional[0], 'the instance name'), serves: need(list(flags.serves), '--serves'), repositories: list(flags.repositories) ?? [] } };
    }
    if (cmd === 'capacity' && rest[0] === 'set') {
      // R-BTN-178: an administrator's statement that the name denotes one thing across every
      // repository — so the command reads what the courses' legs require first (the preflight
      // GET) and asks to confirm before it signs the PUT. --yes answers the prompt beforehand.
      const { flags, positional } = parseArgs(rest.slice(1), ['clear', 'yes'], [], 2);
      const capability = need(positional[0], 'the capability');
      let capacity = null;
      if (!flags.clear) {
        capacity = Number(need(positional[1], 'the capacity (1-64), or --clear'));
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) throw new Error(`the capacity is an integer 1 to 64, not ${positional[1]}`);
      } else if (positional[1] != null) {
        throw new Error('baton admin capacity set <capability> <n> | baton admin capacity set <capability> --clear');
      }
      return {
        method: 'PUT', path: '/v1/admin/capacities', body: { capability, capacity },
        // The confirm print's own read, and the prompt's question:
        preflight: { method: 'GET', path: `/v1/admin/capacities?capability=${encodeURIComponent(capability)}`,
          question: flags.clear ? `clear ${capability}'s capacity (its seats become unlimited)?` : `set ${capability}'s capacity to ${capacity}?` },
        yes: !!flags.yes,
      };
    }
    if (cmd === 'capacity' && rest[0] === 'list') {
      parseArgs(rest.slice(1), [], [], 0);
      return { method: 'GET', path: '/v1/admin/capacities' };
    }
    throw new Error('baton admin repos|repo|grant|probe|resource|instance|capacity|revoke|open');
  }
  if (role === 'owner') {
    if (cmd === 'grants') {
      // B-90: the repository's owners, grants, settings and bars in force, read-only.
      const { positional } = parseArgs(rest, [], [], 1);
      return { method: 'GET', path: `/v1/owner/${encodeURIComponent(need(positional[0], 'the repository id'))}/grants` };
    }
    if (cmd === 'grant') {
      const { flags, positional } = parseArgs(rest, [], GRANT_FLAGS, 1);
      return { method: 'POST', path: `/v1/owner/${need(positional[0], 'the repository id')}/grants`, body: grantBody(flags, readKey, {}) };
    }
    if (cmd === 'revoke') {
      parseArgs(rest.slice(2), [], [], 0);
      return { method: 'POST', path: `/v1/owner/${need(rest[0], 'the repository id')}/grants/${encodeURIComponent(need(rest[1], 'the key fingerprint'))}/revoke`, body: {} };
    }
    if (cmd === 'owners') {
      const { flags, positional } = parseArgs(rest, [], ['add', 'remove'], 1);
      const repo = need(positional[0], 'the repository id');
      if (flags.add) return { method: 'POST', path: `/v1/owner/${repo}/owners`, body: { public_key: readKey(flags.add) } };
      if (flags.remove) return { method: 'POST', path: `/v1/owner/${repo}/owners`, body: { fingerprint: flags.remove, remove: true } };
      throw new Error('baton owner owners REPO --add PUB | --remove FINGERPRINT');
    }
    if (cmd === 'bar' && rest[0] === 'lift') {
      parseArgs(rest.slice(3), [], [], 0);
      return { method: 'POST', path: `/v1/owner/${need(rest[1], 'the repository id')}/bars/${need(rest[2], 'the bar id')}/lift`, body: {} };
    }
    if (cmd === 'bar') {
      const { flags, positional } = parseArgs(rest, ['release-holders'], ['course', 'tag', 'legs', 'applies', 'starts-at', 'ends-at', 'reason'], 1);
      return { method: 'POST', path: `/v1/owner/${need(positional[0], 'the repository id')}/bars`, body: {
        course: need(flags.course, '--course'), tag: need(flags.tag, '--tag'), ...(flags.legs ? { legs: list(flags.legs) } : {}),
        applies: need(flags.applies, '--applies'), ...(flags['starts-at'] ? { starts_at: time(flags['starts-at'], '--starts-at') } : {}),
        ...(flags['ends-at'] ? { ends_at: time(flags['ends-at'], '--ends-at') } : {}), ...(flags['release-holders'] ? { release_holders: true } : {}),
        reason: need(flags.reason, '--reason'),
      } };
    }
    if (cmd === 'settings') {
      const { flags, positional, groups } = parseArgs(rest, ['no-required-bars', 'require-signed-control', 'no-require-signed-control'], ['required-bar', 'course', 'except', 'tag-prefix', 'retry', 'max-failed', 'transcript-repos', 'unblocked-workflow', 'remind-after', 'code-repos', 'forge-ids', 'pushers'], 1);
      const body = {};
      if (flags['no-required-bars']) {
        if (groups.length) throw new Error('--no-required-bars clears them: name no --required-bar beside it');
        body.required_bars = [];
      }
      if (groups.length) {
        body.required_bars = groups.map((g) => ({ course: need(g.course, '--course (after --required-bar)'), leg: g.leg, ...(g.except ? { except: list(g.except) } : {}), tag_prefix: need(g['tag-prefix'], '--tag-prefix (after --required-bar)') }));
      }
      // `--retry default` returns to Baton's default policy (R-BTN-23).
      if (flags.retry === 'default') body.retry = null;
      else if (flags.retry) body.retry = { backoff_ms: list(flags.retry).map(duration), max_failed: Number(need(flags['max-failed'], '--max-failed (with --retry)')) };
      if (flags['transcript-repos']) body.transcript_repos = list(flags['transcript-repos']);
      // R-BTN-77's trigger: a workflow path on GitHub, or `none` to clear it.
      if (flags['unblocked-workflow'] === 'none') body.unblocked_trigger = null;
      else if (flags['unblocked-workflow']) body.unblocked_trigger = { kind: 'github-app', workflow: flags['unblocked-workflow'] };
      // R-BTN-80: how long a sent notice waits for its decision before it is queued again, in seconds.
      if (flags['remind-after']) body.remind_after = Math.round(duration(flags['remind-after']) / 1000);
      // B-127 (R-BTN-66 as amended): control inputs count only at owner-signed commits. On
      // tightens — any owner may; off is a loosening an `approvers.policy` approver signs for.
      if (flags['require-signed-control'] && flags['no-require-signed-control']) throw new Error('--require-signed-control and --no-require-signed-control name one state, not both');
      if (flags['require-signed-control']) body.require_signed_control = true;
      if (flags['no-require-signed-control']) body.require_signed_control = false;
      // B-182 (R-BTN-140): the home's code repositories — each `[<forge>:]<path>[@<host>]`, or
      // `none` to clear the list. The ids are read from each entry's forge with the operator's
      // token (GITHUB_TOKEN, GITLAB_TOKEN, GITEA_TOKEN) or taken from --forge-ids, and posted;
      // `main` resolves them before the PUT goes out.
      let resolveCodeRepos = null;
      if (flags['code-repos'] !== undefined) {
        if (flags['code-repos'] === 'none') body.code_repos = [];
        else {
          const { entries, offline } = codeReposSpec(flags['code-repos'], flags['forge-ids']);
          body.code_repos = entries;
          if (entries.some((e) => e.repo_id == null)) resolveCodeRepos = { repository: need(positional[0], 'the repository id'), offline };
        }
      }
      // B-182 (R-BTN-139): the owners' pushers, host-qualified — `id[@host]`, a comma list, or
      // `none` to clear; a host-less entry is the home's host.
      if (flags.pushers !== undefined) body.pushers = flags.pushers === 'none' ? null : pushersSpec(flags.pushers);
      if (!Object.keys(body).length) throw new Error('baton owner settings REPO names at least one setting');
      return { method: 'PUT', path: `/v1/owner/${need(positional[0], 'the repository id')}/settings`, body, ...(resolveCodeRepos ? { resolveCodeRepos } : {}) };
    }
    if (cmd === 'courier' && rest[0] === 'add') {
      const { flags, positional } = parseArgs(rest.slice(1), [], ['key', 'asks'], 1);
      return { method: 'POST', path: `/v1/owner/${need(positional[0], 'the repository id')}/couriers`, body: { public_key: readKey(need(flags.key, '--key')), asks: need(list(flags.asks), '--asks') } };
    }
    if (cmd === 'courier' && rest[0] === 'revoke') {
      parseArgs(rest.slice(3), [], [], 0);
      return { method: 'POST', path: `/v1/owner/${need(rest[1], 'the repository id')}/couriers`, body: { fingerprint: need(rest[2], 'the key fingerprint'), revoke: true } };
    }
    if (cmd === 'resolve') {
      // R-BTN-78: an owner's answer to one of Baton's own decisions on a ticket.
      const { positional } = parseArgs(rest, [], [], 4);
      const [repo, ticket, decision, answer] = positional;
      const local = need(ticket, 'the ticket');
      return { method: 'POST', path: `/v1/owner/${encodeURIComponent(need(repo, 'the repository id'))}/tickets/${encodeURIComponent(local.includes(':') ? local : `${repo}:${local}`)}/resolve`,
        body: { decision: need(decision, "the decision (baton:retries, baton:stalled or one the ticket's sync posted)"), answer: need(answer, "the answer (retry or park, or one of the posted decision's options)") } };
    }
    throw new Error('baton owner grants|grant|revoke|owners|bar|settings|courier|resolve');
  }
  throw new Error('baton admin … | baton owner … | baton board REPO');
}

const GRANT_FLAGS = ['key', 'hostname', 'label', 'capabilities', 'max-tier'];

/** R-BTN-178's confirm (B-106): print every course whose legs require the capability, with the
 *  type's definition in each, then ask. `--yes` answers beforehand; without a TTY the command
 *  refuses rather than prompt a pipe. `out` and `in` are injected for the test. */
export async function confirmCapacity(answer, question, yes, out, input) {
  const requiring = Array.isArray(answer?.requiring) ? answer.requiring : [];
  if (requiring.length) {
    for (const c of requiring) {
      const type = c.type ? ` — ${c.type.description} (values ${c.type.values})` : '';
      out.write(`${c.repository}/${c.course} v${c.version}: its legs ${c.legs.join(', ')} require it${type}\n`);
    }
  } else {
    out.write(`no course of this Baton names the capability in a leg's requires — setting it is the administrator's own statement of the name\n`);
  }
  for (const c of Array.isArray(answer?.capacities) ? answer.capacities : []) {
    if (c.capacity != null) out.write(`${c.capability}: capacity ${c.capacity} (set ${new Date(c.set_at).toISOString()} by ${c.set_by})\n`);
  }
  if (yes) return true;
  if (!input.isTTY) {
    out.write('baton: not confirmed — answer the prompt on a terminal, or pass --yes\n');
    return false;
  }
  out.write(`${question} [y/N] `);
  const line = await new Promise((resolve) => {
    input.once('data', (d) => resolve(String(d).trim().toLowerCase()));
  });
  return line === 'y' || line === 'yes';
}

/** A JSON argument: inline (`{…}`), else a file holding it. */
function jsonArg(v, readJson) {
  const text = v.trim().startsWith('{') ? v : readJson(v);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${v.slice(0, 40)}: not JSON`);
  }
}

/** B-182 (R-BTN-140): one `--code-repos` entry as the operator writes it —
 *  `[<forge>:]<path>[@<host>]`, a comma list. Omitted forge and host are the home's (the
 *  resolver fills them from the home's registration); a well-known host implies its forge.
 *  `--forge-ids <repo>,<owner>` supplies the ids offline for one entry; otherwise `main`
 *  reads them from the entry's forge before the PUT goes out. Pure, beside `plan`. */
export function codeReposSpec(value, forgeIds = null) {
  const known = { 'github.com': 'github', 'gitlab.com': 'gitlab', 'gitea.com': 'gitea' };
  let offline = null;
  if (forgeIds != null) {
    const [repo, owner, ...extra] = String(forgeIds).split(',');
    if (!/^\d+$/.test(repo ?? '') || !/^\d+$/.test(owner ?? '') || extra.length) {
      throw new Error(`--forge-ids takes <repo id>,<owner id> as decimal numbers, not ${forgeIds}`);
    }
    offline = { repo_id: repo, owner_id: owner };
  }
  const entries = list(value).map((raw) => {
    const m = /^(?:([a-z]+):)?([^@]+)(?:@([^@]+))?$/.exec(raw);
    if (!m) throw new Error(`--code-repos takes [<forge>:]<owner>/<name>[@<host>] entries, not ${raw}`);
    const [, forge, path, host] = m;
    const byHost = host != null && forge == null ? known[host.toLowerCase()] : undefined;
    return {
      path,
      ...(forge != null || byHost != null ? { forge: forge ?? byHost } : {}),
      ...(host != null ? { host: host.toLowerCase() } : {}),
      ...(offline ?? {}),
    };
  });
  if (offline != null && entries.length !== 1) throw new Error('--forge-ids supplies the ids of one --code-repos entry');
  return { entries, offline };
}

/** B-182 (R-BTN-139): `--pushers` — `id[@host]`, a comma list; a host-less entry is the home's. */
export function pushersSpec(value) {
  return list(value).map((raw) => {
    const at = raw.lastIndexOf('@');
    const [id, host] = at < 0 ? [raw, null] : [raw.slice(0, at), raw.slice(at + 1)];
    if (!/^\d+$/.test(id) || (host != null && !/^[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?$/.test(host))) {
      throw new Error(`--pushers takes <forge user id>[@<host>] entries, not ${raw}`);
    }
    return host == null ? { id } : { host, id };
  });
}

/** Fill the ids and defaults a `--code-repos` list still lacks, before the settings PUT goes out
 *  (R-BTN-138's way: the CLI reads the forge, Baton never fetches). Host-less entries take the
 *  home's forge and host — read from its registration, one signed GET — and each entry's ids are
 *  read from its forge with the operator's token for that host (GITHUB_TOKEN, GITLAB_TOKEN,
 *  GITEA_TOKEN), or taken from the `--forge-ids` the spec already folded in. */
export async function resolveCodeRepos(url, keyFile, entries, { repository, fetchImpl = fetch, env = process.env } = {}) {
  let home = null;
  if (entries.some((e) => e.forge == null || e.host == null)) {
    const read = await send(url, { method: 'GET', path: `/v1/owner/${encodeURIComponent(repository)}/grants` }, keyFile, fetchImpl);
    if (!(read.status >= 200 && read.status < 300)) throw new Error(`reading ${repository}'s registration for --code-repos defaults: ${read.json?.code ?? read.status}: ${read.json?.message ?? 'refused'}`);
    home = homeOf(read.json.settings);
  }
  const out = [];
  for (const e of entries) {
    const forge = e.forge ?? home?.forge;
    const host = e.host ?? home?.host;
    if (forge == null || host == null) {
      throw new Error(`${e.path}: its forge and host cannot be defaulted (the home is a plain git repository) — write --code-repos ${e.path}@<host> with the forge named, e.g. github:${e.path}@github.com`);
    }
    if (e.repo_id != null && e.owner_id != null) {
      out.push({ path: e.path, forge, host, repo_id: e.repo_id, owner_id: e.owner_id });
      continue;
    }
    const token = env[`${forge.toUpperCase()}_TOKEN`];
    if (!token) throw new Error(`${e.path}: no ${forge.toUpperCase()}_TOKEN to read its ids from ${host} — set it, or pass --forge-ids <repo id>,<owner id>`);
    const base = forgeApi(forge, host);
    const res = await fetchImpl(`${base}${repoPath(forge, e.path)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'baton-cli' } });
    if (!res.ok) throw new Error(`${forge} (${host}) answered ${res.status} for ${e.path}: the token cannot read it, or it does not exist`);
    const ids = forgeIdsOf(forge, await res.json());
    if (ids == null) throw new Error(`${forge} (${host}) answered no repository and owner ids for ${e.path}`);
    out.push({ path: e.path, forge, host, repo_id: ids.repo_id, owner_id: ids.owner_id });
  }
  return out;
}

/** A forge's REST origin for `host`: GitHub's own is api.github.com; an Enterprise host serves
 *  `/api/v3`; GitLab `/api/v4`; Gitea `/api/v1`. */
function forgeApi(forge, host) {
  if (forge === 'github') return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  if (forge === 'gitlab') return `https://${host}/api/v4`;
  return `https://${host}/api/v1`;
}

/** The REST path that reads a repository's ids on each forge. */
function repoPath(forge, path) {
  if (forge === 'github') return `/repos/${path}`;
  if (forge === 'gitlab') return `/projects/${encodeURIComponent(path)}`;
  return `/repos/${path}`;
}

/** The ids each forge's repository answer carries: GitHub and Gitea `{id, owner: {id}}`, GitLab
 *  `{id, namespace: {id}}`. */
function forgeIdsOf(forge, body) {
  const repo = body?.id, owner = forge === 'gitlab' ? body?.namespace?.id : body?.owner?.id;
  return repo != null && owner != null ? { repo_id: String(repo), owner_id: String(owner) } : null;
}

/** The home's forge and host from an owner settings row (B-182): its forge, and its `web_base`'s
 *  authority — null on a plain git home, which names neither. */
function homeOf(settings) {
  if (!settings) return null;
  const host = settings.web_base != null ? new URL(settings.web_base).host.toLowerCase() : null;
  return { forge: settings.forge ?? 'github', host };
}

/** `--ci-identity` (R-BTN-93): none, github-actions, or a GitLab issuer (`gitlab-mirror:` when its
 *  mirror posts with the same identity). */
function ciIdentity(v) {
  if (v === 'none') return null;
  if (v === 'github-actions') return { kind: 'github-actions' };
  const m = /^gitlab(-mirror)?:(https:\/\/.+)$/.exec(v);
  if (m) return { kind: 'gitlab-ci', issuer: m[2], mirror: !!m[1] };
  throw new Error(`--ci-identity: none, github-actions, gitlab:<issuer> or gitlab-mirror:<issuer>, not ${v}`);
}

function grantBody(flags, readKey, extra) {
  return {
    ...extra, public_key: readKey(need(flags.key, '--key')), ...(flags.hostname ? { hostname: flags.hostname } : {}), ...(flags.label ? { label: flags.label } : {}),
    capabilities: list(flags.capabilities) ?? [], ...(flags['max-tier'] ? { max_tier: flags['max-tier'] } : {}),
  };
}

/** `baton key create FILE [--comment TEXT]` (R-BTN-159): an API key, made here and never sent
 *  anywhere. FILE (mode 0600) holds the key, for `-i FILE` or a runner's BATON_KEY_FILE;
 *  FILE.pub holds its public line — what BATON_ADMIN_KEYS lists, `--owner-key FILE.pub` or
 *  `--key FILE.pub` registers. */
export function createApiKey(file, comment = '') {
  if (existsSync(file) || existsSync(`${file}.pub`)) throw new Error(`${file} or ${file}.pub already exists`);
  const key = `bak_${randomBytes(8).toString('hex')}_${randomBytes(32).toString('hex')}`;
  const line = `${key.slice(0, 20)} sha256:${createHash('sha256').update(key).digest('hex')}${comment ? ` ${comment}` : ''}`;
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  writeFileSync(`${file}.pub`, `${line}\n`);
  return line;
}

/** A redirect, named for what it is (B-80): an intermediary in front of Baton — Cloudflare
 *  Access's login — answered, so the request never reached Baton. */
const redirectAnswered = (target, status, to) => new Error(
  `a redirect answered ${target}${status ? ` (HTTP ${status}${to ? ` to ${to}` : ''})` : ''} — not followed; the request never reached Baton (an Access login in front of it?)`,
);

/** Send a planned request, signed with `keyFile` — or, when it holds an API key (R-BTN-159),
 *  with that key as a bearer. Returns `{status, json, text}`: `json` is null when the body is
 *  not JSON, `text` the body as it arrived, for the caller to show. A redirect is refused,
 *  never followed (B-80): a 3xx is an error naming what answered — a login page in front of
 *  Baton is not Baton's answer. */
export async function send(url, p, keyFile, fetchImpl = fetch) {
  const cred = requestCredential(keyFile);
  const target = new URL(p.path, url).toString();
  // A GET carries no body; its digest is of the empty one.
  const body = p.method === 'GET' ? undefined : JSON.stringify(p.body ?? {});
  const auth = cred.bearer ? { Authorization: `Bearer ${cred.bearer}` } : signHeaders({ method: p.method, url: target, body, key: cred.key });
  const headers = { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...auth };
  // A Baton that does not answer in 30 seconds is reported, never waited on for ever (round 3, 3-A-5).
  let res;
  try {
    // A 3xx is never followed (B-80): `redirect: 'error'` makes fetch refuse it outright.
    res = await fetchImpl(target, { method: p.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    // `redirect: 'error'` surfaces that refusal as a fetch failure whose cause names it: report
    // what happened, not the generic failure (B-80).
    if (/redirect/i.test(`${e?.message ?? ''} ${e?.cause?.message ?? ''}`)) throw redirectAnswered(target);
    throw e;
  }
  // A fetch stand-in may hand the 3xx back instead of throwing: the same refusal (B-80).
  if (res.status >= 300 && res.status < 400) throw redirectAnswered(target, res.status, res.headers.get('location'));
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  return { status: res.status, json, text: raw };
}

/** The base a course change is judged against: `--base`, else the remote's default branch. */
export function defaultBase(root) {
  for (const ref of ['origin/HEAD', 'origin/main']) {
    try {
      execFileSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' });
      return ref;
    } catch {
      // not there: the next one
    }
  }
  return null;
}

/** `baton test-course` (R3-1248): exit 0 when the kit finds nothing, 1 naming each violation. */
async function testCourse(argv) {
  const { flags, positional } = parseArgs(argv, [], ['base', 'board'], 2);
  if (positional.length !== 2) throw new Error('usage: baton test-course <repository root> <course> [--base REF] [--board FILE]');
  const root = resolve(positional[0]);
  // A base that does not resolve fails the run, never skips a rule unseen (round 1, 1-A-3).
  const base = flags.base === 'none' ? null : flags.base ?? defaultBase(root);
  if (base === null && flags.base !== 'none') throw new Error(`no origin/HEAD or origin/main in ${root}: pass --base REF (fetch the base first), or --base none to skip the removal rule`);
  const { bundleLocal } = await import('../scripts/bundle.mjs');
  const kit = await bundleLocal('src/local/testCourse.ts', 'test-course.mjs');
  const input = await kit.readInputs(root, positional[1], { base, board: flags.board ?? null });
  const violations = await kit.checkCourse(input);
  const said = [
    `course ${positional[1]} in ${root}`,
    base ? `against ${base}${input.base ? '' : ' (no such course there: a new course)'}` : 'with --base none (the removal rule is not checked)',
    input.live ? `${input.live.length} live ticket(s) replayed` : 'no --board (live tickets not replayed)',
    input.legScripts ? `${input.legScripts.length} leg script(s)` : 'no legs/',
  ];
  process.stdout.write(`baton test-course: ${said.join('; ')}\n`);
  for (const v of violations) process.stdout.write(`✗ ${v.rule}: ${v.message}\n`);
  process.stdout.write(violations.length ? `${violations.length} violation(s)\n` : '✓ no violations\n');
  return violations.length ? 1 : 0;
}

/** `baton decision list` (R-BTN-80): the CLI courier, each request signed with the key `-i` names. */
async function decisionList(argv) {
  const { flags } = parseArgs(argv, ['watch', 'all'], ['identity', 'url'], 0);
  if (flags.watch && flags.all) throw new Error('--watch claims notices as they come; --all lists the open decisions once: name one');
  const url = flags.url ?? process.env.BATON_URL ?? DEFAULT_URL;
  const keyFile = need(flags.identity, '-i KEY (your courier key file)');
  const request = (method, path, body) => send(url, { method, path, body }, keyFile);
  const write = (text) => process.stdout.write(`${text}\n`);
  const { listOnce, watch } = await import('./decisions.mjs');
  if (flags.watch) await watch(request, write, { warn: (text) => process.stderr.write(`${text}\n`) });
  else await listOnce(request, write, { all: !!flags.all });
  return 0;
}

/**
 * `baton decision answer TICKET OPTION` (R-BTN-127, R-BTN-116): a person's answer to the ticket's
 * queued person leg, a `std:decision@1` through `POST /v1/repositories/{repository}/attestations`,
 * signed with an owner key of the repository or a human-only key. Pure planning beside `plan`, so
 * the tests check the request without a Baton.
 */
export function answerPlan(ticket, option, ref) {
  const i = String(ticket).indexOf(':');
  if (i < 1) throw new Error('the ticket is <repository>:<id>');
  return {
    method: 'POST',
    path: `/v1/repositories/${encodeURIComponent(String(ticket).slice(0, i))}/attestations`,
    body: { type: 'std:decision@1', subject: { ticket: String(ticket).slice(i + 1) }, value: { option, ...(ref ? { ref } : {}) } },
  };
}

/** The command: one request, the answer's arrival printed as one line (R-BTN-39) — deferred
 *  when a claim holds the ticket, which the alarm applies when the hold ends. */
async function decisionAnswer(argv) {
  const { flags, positional } = parseArgs(argv, [], ['identity', 'url', 'ref'], 2);
  const p = answerPlan(need(positional[0], 'the ticket, <repository>:<id>'), need(positional[1], 'the option the person chose'), flags.ref);
  const url = flags.url ?? process.env.BATON_URL ?? DEFAULT_URL;
  const keyFile = need(flags.identity, '-i KEY (an owner key of the repository, or a human-only key)');
  const { status, json } = await send(url, p, keyFile);
  if (!(status >= 200 && status < 300)) throw new Error(`${json?.code ?? status}: ${json?.message ?? 'refused'}`);
  process.stdout.write(`${json.ticket ?? positional[0]}: ${p.body.value.option} → ${json.reached}${json.deferred ? ' (a claim holds the ticket; applied when it ends)' : ''}\n`);
  return 0;
}

// ── `baton owner policy …` (§12.8 R-BTN-188/R-BTN-189, B-145) ────────────────────────────

/** The policy's knobs, dotted, in the spec table's order — the CLI's own copy of
 *  src/core/policy.ts's KNOBS, which the bundled core cannot share with this file. */
const POLICY_KNOBS = [
  'approvers.members', 'approvers.trust', 'approvers.policy', 'human_key',
  'grants.default_trust', 'grants.one_per_domain', 'grants.trusted_domain',
  'refs.default_branch', 'refs.tags', 'refs.other', 'refs.baton', 'refs.legs',
  'paths.protected', 'paths.control', 'paths.tickets',
  'merge.trusted', 'merge.reviews', 'merge.checks', 'authorship', 'tickets.created', 'leg_state',
  'outbox.git', 'outbox.forge-check', 'inputs.board', 'inputs.answers', 'attestations', 'readings',
];

/** One knob's value, read out of a document by its dotted path. */
const knobOf = (doc, knob) => knob.split('.').reduce((v, seg) => (v && typeof v === 'object' ? v[seg] : undefined), doc);

/** A value as the canonical JSON the core hashes and diffs over: objects with sorted keys, so a
 *  stored document and a rebuilt one differ in key order alone, which is no change. */
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : (JSON.stringify(v) ?? 'null');

/** The knobs a change from `oldDoc` to `newDoc` touches — `baton owner policy diff` (pure, so
 *  the tests check it alone). */
export function policyDiff(oldDoc, newDoc) {
  return POLICY_KNOBS.filter((k) => canonical(knobOf(oldDoc, k)) !== canonical(knobOf(newDoc, k)));
}

/** `baton owner policy …`: show and diff read the signed policy read (R-BTN-189 — a deployment
 *  verifies its signature against the tenant key it pinned; the CLI shows the fields and the
 *  signature beside them), set and apply compare-and-set on the `--base` version the operator
 *  READ (never a version the CLI fetches itself: a fresh fetch would overwrite a concurrent
 *  change sight unseen, defeating the compare-and-set — round 1, finding 9; `show` names the
 *  version), and the floor commands register and remove a deployment's floors. */
async function policyMain(argv) {
  // `-i KEY` and `--url URL` may sit before the subcommand — `baton owner -i KEY policy show
  // REPO` is the documented form — or after it, as every other command takes them.
  const isFlagOrValue = (_, i, a) => a[i] === '-i' || a[i - 1] === '-i' || a[i] === '--url' || a[i - 1] === '--url';
  const { flags: globalFlags } = parseArgs(argv.filter(isFlagOrValue));
  const args = argv.filter((x, i, a) => !isFlagOrValue(x, i, a));
  const url = globalFlags.url ?? process.env.BATON_URL ?? DEFAULT_URL;
  const keyFile = need(globalFlags.identity, '-i KEY (an owner key file)');
  const request = (method, path, body) => send(url, { method, path, body }, keyFile);
  const write = (text) => process.stdout.write(`${text}\n`);
  const [sub, ...rest] = args;
  if (sub === 'show') {
    const { positional } = parseArgs(rest, [], ['identity', 'url'], 1);
    const repo = need(positional[0], 'the repository id');
    const out = await request('GET', `/v1/repositories/${encodeURIComponent(repo)}/policy`);
    if (out.status !== 200) return write(arrived(out.text)), 1;
    write(JSON.stringify(out.json));
    process.stderr.write(`baton: verify ${out.json.repository}@${out.json.version} against your pinned tenant key (${out.json.kid}); the read lives until ${new Date(out.json.valid_until).toISOString()}\n`);
    return 0;
  }
  if (sub === 'diff') {
    const { positional } = parseArgs(rest, [], ['identity', 'url'], 2);
    const [repo, file] = positional;
    const out = await request('GET', `/v1/repositories/${encodeURIComponent(need(repo, 'the repository id'))}/policy`);
    if (out.status !== 200) return write(arrived(out.text)), 1;
    let next;
    try {
      next = JSON.parse(readFileSync(need(file, 'the policy file'), 'utf8'));
    } catch (e) {
      throw new Error(`${file}: not JSON (${e.message})`);
    }
    const changed = policyDiff(out.json.policy, next);
    write(changed.length ? changed.join('\n') : '(no knob changes)');
    return 0;
  }
  if (sub === 'log') {
    const { flags, positional } = parseArgs(rest, [], ['after', 'identity', 'url'], 1);
    const q = new URLSearchParams(flags.after ? { after: flags.after } : {});
    const out = await request('GET', `/v1/owner/${encodeURIComponent(need(positional[0], 'the repository id'))}/policy/log${q.size ? `?${q}` : ''}`);
    if (out.status !== 200) return write(arrived(out.text)), 1;
    write(JSON.stringify(out.json));
    return 0;
  }
  if (sub === 'set' || sub === 'apply') {
    const { flags, positional } = parseArgs(rest, [], ['base', 'identity', 'url'], 2);
    const [repo, what] = positional.map((x) => need(x, sub === 'set' ? 'the repository id and the policy file' : 'the repository id and the preset name'));
    // R-BTN-188: the change builds on the version the OPERATOR read — the one `show` printed —
    // so a concurrent change is a `conflict` the operator sees, never one this overwrites.
    const base = need(baseOf(flags.base), '--base N (the version your change builds on — `baton owner policy show` names it; a stale one answers conflict)');
    const body = sub === 'apply' ? { base_version: base, preset: what } : { base_version: base, policy: JSON.parse(readFileSync(what, 'utf8')) };
    const out = await request('PUT', `/v1/owner/${encodeURIComponent(repo)}/policy`, body);
    write(JSON.stringify(out.json));
    return out.status >= 200 && out.status < 300 ? 0 : 1;
  }
  if (sub === 'floor' && rest[0] === 'add') {
    const { flags, positional } = parseArgs(rest.slice(1), [], ['guarantees', 'remove-by', 'identity', 'url'], 2);
    const out = await request('POST', `/v1/owner/${encodeURIComponent(need(positional[0], 'the repository id'))}/policy/floors`,
      { name: need(positional[1], 'the floor name'), guarantees: need(list(flags.guarantees), '--guarantees'), ...(flags['remove-by'] ? { remove_by: flags['remove-by'] } : {}) });
    write(JSON.stringify(out.json));
    return out.status >= 200 && out.status < 300 ? 0 : 1;
  }
  if (sub === 'floor' && rest[0] === 'remove') {
    const { positional } = parseArgs(rest.slice(1), [], ['identity', 'url'], 2);
    const out = await request('POST', `/v1/owner/${encodeURIComponent(need(positional[0], 'the repository id'))}/policy/floors`,
      { name: need(positional[1], 'the floor name'), remove: true, confirm: true });
    write(JSON.stringify(out.json));
    return out.status >= 200 && out.status < 300 ? 0 : 1;
  }
  throw new Error('baton owner policy show|diff|log|set|apply|floor add|floor remove');
}

/** `--base` as the version number the PUT carries. */
function baseOf(v) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error('--base must be the version number you read (as `baton owner policy show` printed it)');
  return n;
}


/** What arrived instead of Baton's JSON: its first 300 characters, an empty body named (B-80). */
const arrived = (text) => (text.length > 300 ? `${text.slice(0, 300)}…` : text) || '(an empty body)';

/** The one management path's exit: 0 when Baton answered its JSON, 1 when the answer was not
 *  Baton's — a refusal, or a 2xx body that is not JSON (B-80) — and any error thrown up to the
 *  caller (the CLI prints `baton: …` and exits 2). Exported for the tests of that contract. */
export async function main(argv) {
  // B-138: an owner or administrator key signs with the code that reads it, so the CLI that
  // takes one is a pinned release — never a git working tree, whose code a push (a branch a leg
  // checks out) changes. `--dev` is the override for this repository's own development; the
  // other roles (the reads, the runner, the repository commands) run from a checkout still.
  if (argv[0] === 'admin' || argv[0] === 'owner') {
    const dev = devFlagPositions(argv);
    const end = argv.indexOf('--') === -1 ? argv.length : argv.indexOf('--');
    if (dev.length > 0 && dev.length === argv.slice(0, end).reduce((n, a) => n + (a === '--dev' ? 1 : 0), 0)) {
      argv = argv.filter((_, i) => !dev.includes(i));   // every --dev sits in flag position: the override
    } else if (workingTreeOf() != null) {
      throw new Error(workingTreeRefusal(argv));
    }
  }
  if (argv[0] === 'test-course') return testCourse(argv.slice(1));
  if (argv[0] === 'key') {
    if (argv[1] !== 'create' || !argv[2]) throw new Error('baton key create FILE [--comment TEXT]');
    const { flags } = parseArgs(argv.slice(3), [], ['comment'], 0);
    process.stdout.write(`${createApiKey(argv[2], flags.comment ?? '')}\n`);
    process.stderr.write(`baton: the key is in ${argv[2]} (keep it secret; -i ${argv[2]}), its public line above and in ${argv[2]}.pub\n`);
    return 0;
  }
  if (argv[0] === 'decision') {
    // R-BTN-116, R-BTN-127: a person's answer to a queued person leg, or the courier's list.
    if (argv[1] === 'answer') return decisionAnswer(argv.slice(2));
    if (argv[1] !== 'list') throw new Error('baton decision list -i KEY [--watch | --all] | baton decision answer -i KEY <repository>:<id> <option>');
    return decisionList(argv.slice(2));
  }
  if (argv[0] === 'owner') {
    // `-i KEY` (and `--url URL`) may sit between `owner` and its subcommand: `baton owner -i KEY
    // policy show REPO` is the documented form (round 1, finding 10). The flags stay in what
    // policyMain receives; only the `policy` word is taken out.
    const rest = argv.slice(1);
    // B-127 round 1: a `-m`/`--repo` value that is itself the `-i`/`--url` flag shape is refused
    // by name, BEFORE the token filter below eats it and the command misparses
    // (`owner sign -m --url -- p` used to lose the value token and end in a confusing refusal).
    for (let i = 0; i < rest.length; i++) {
      if ((rest[i] === '-m' || rest[i] === '--message' || rest[i] === '--repo') && (rest[i + 1] === '-i' || rest[i + 1] === '--url')) {
        throw new Error(`${rest[i]} needs a plain value — ${rest[i + 1]} is a flag of its own (quote a value that starts with a dash)`);
      }
    }
    const clean = rest.filter((_, i, a) => !(a[i] === '-i' || a[i - 1] === '-i' || a[i] === '--url' || a[i - 1] === '--url'));
    const flagsOf = () => parseArgs(rest.filter((_, i, a) => a[i] === '-i' || a[i - 1] === '-i' || a[i] === '--url' || a[i - 1] === '--url'), [], ['identity', 'url'], 0).flags;
    // B-127 item 6: `baton owner -i KEY sign` — a commit signed the way `require_signed_control`
    // counts (git's `gpg.format ssh`, the SSHSIG namespace `git`), made with the key `-i` names.
    // Plain `git commit -S` with the same configuration is exactly as good (the runbook says so);
    // this wraps it so the ceremony is one command. It is a local git command, never a request.
    if (clean[0] === 'sign') {
      const flags = flagsOf();
      const keyFile = need(flags.identity, '-i KEY (the owner key that signs the commit)');
      signingKey(keyFile); // refuses a file ssh-keygen cannot sign with, before git is run
      const args = clean.slice(1);
      let message = 'owner-signed control change';
      const paths = [];
      let repo = '.';
      // A flag-shaped token is never a value: `-m --url -- p` would otherwise lose `--url`'s
      // place to the `-i`/`--url` filter above and misparse into a confusing refusal (round 1).
      const flagShaped = (v) => v === '-i' || v === '--url' || v === '-m' || v === '--message' || v === '--repo' || v === '--';
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-m' || args[i] === '--message') {
          const v = args[++i];
          if (v === undefined) throw new Error(`${args[i - 1]} needs a value`);
          if (flagShaped(v)) throw new Error(`${args[i - 1]} needs a plain value (quote a message that starts with a dash)`);
          message = v;
        } else if (args[i] === '--repo') {
          const v = args[++i];
          if (v === undefined) throw new Error('--repo needs a value');
          if (flagShaped(v)) throw new Error(`--repo needs a plain value, not ${v}`);
          repo = v;
        } else if (args[i] === '--') { paths.push(...args.slice(i + 1)); break; }
        else throw new Error(`${args[i]}: not a flag of \`baton owner sign\` (-m TEXT, --repo DIR, -- <paths>)`);
      }
      if (!paths.length) throw new Error('baton owner sign names no path: commit paths explicitly (`-- .baton/baton.json`), the way a leg does — never the whole tree');
      const out = execFileSync('git', ['-C', repo, '-c', 'gpg.format=ssh', `-c`, `user.signingkey=${realpathSync(keyFile)}`, 'commit', '-S', '--no-verify', '-m', message, '--', ...paths], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      process.stdout.write(out);
      process.stderr.write(`baton: signed with ${keyFile} — a commit \`require_signed_control\` counts (B-127)\n`);
      return 0;
    }
    // B-127 item 1's verifier: the agent-configuration check a privileged session's opener runs.
    // The keys come from Baton with the owner's key; the walk runs in the checkout.
    if (clean[0] === 'verify-config') {
      const flags = flagsOf();
      const url = flags.url ?? process.env.BATON_URL ?? DEFAULT_URL;
      const keyFile = need(flags.identity, '-i KEY (an owner key of the repository)');
      const args = clean.slice(1);
      const checkoutAt = args.indexOf('--checkout');
      // `--checkout DIR` takes DIR with it (round 1: the old filter also dropped index 0 when
      // there was no --checkout, eating the REPOSITORY positional of the documented
      // no---checkout form, which then always hit the usage error).
      const positional = args.filter((_, i) => i !== checkoutAt && (checkoutAt < 0 || i !== checkoutAt + 1));
      if (positional.length !== 1) throw new Error('baton owner -i KEY verify-config REPOSITORY [--checkout DIR]');
      const read = await send(url, { method: 'GET', path: `/v1/owner/${encodeURIComponent(positional[0])}/signing-keys` }, keyFile);
      if (!(read.status >= 200 && read.status < 300)) {
        process.stdout.write(`${JSON.stringify(read.json)}\n`);
        return 1;
      }
      const { verifyConfigMain } = await import('../scripts/baton-cli.mjs');
      return await verifyConfigMain(args, { keys: read.json?.keys ?? [] });
    }
    let cut = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '-i' || rest[i] === '--url') { i += 1; continue; }
      if (rest[i] === 'policy') cut = i;
      break;
    }
    if (cut >= 0) return policyMain(rest.filter((_, i) => i !== cut));
  }
  if (argv[0] === 'run') {
    // §6.13: the runner is TypeScript under src/runner; bundle it (a checkout runs the CLI with
    // its devDependencies), then run it in this process's stead.
    const { runMain } = await import('../scripts/baton-run.mjs');
    return runMain(argv.slice(1));
  }
  if (argv[0] === 'repo' && (argv[1] === 'sync' || argv[1] === 'init' || argv[1] === 'migrate-markers')) {
    // §2f, R-BTN-127's names: the defaults are TypeScript under src/defaults, bundled the same way.
    const { parseSyncArgs, syncMain, initMain, migrateMarkersMain } = await import('../scripts/baton-cli.mjs');
    if (argv[1] === 'sync') return syncMain(parseSyncArgs(argv.slice(2)));
    if (argv[1] === 'migrate-markers') return migrateMarkersMain(argv.slice(2));
    return initMain(argv.slice(2));
  }
  if (argv[0] === 'tickets') {
    // B-111's check, and B-112's ticket commands: repository commands in the defaults beside
    // `repo sync` (src/defaults/tickets.ts), each writing one commit pushed to the default branch.
    const { ticketsMain } = await import('../scripts/baton-cli.mjs');
    return ticketsMain(argv.slice(1));
  }
  if (argv[0] === 'request') {
    // B-98: a course started from one sentence. A repository command — it commits the request
    // ticket and pushes it — so it lives in the defaults beside `tickets check` (src/defaults/request.ts).
    const { requestMain } = await import('../scripts/baton-cli.mjs');
    return requestMain(argv.slice(1));
  }
  const [role, ...rest] = argv;
  const { flags } = parseArgs(rest.filter((_, i, a) => a[i] === '-i' || a[i - 1] === '-i' || a[i] === '--url' || a[i - 1] === '--url'));
  const args = rest.filter((_, i, a) => !(a[i] === '-i' || a[i - 1] === '-i' || a[i] === '--url' || a[i - 1] === '--url'));
  const p = plan(role, args);
  const url = flags.url ?? process.env.BATON_URL ?? DEFAULT_URL;
  const keyFile = need(flags.identity, '-i KEY (an administrator, owner or worker key file)');
  // B-182 (R-BTN-140): `--code-repos` entries whose ids the operator did not supply offline are
  // read from their forge here, before the settings PUT goes out — Baton never fetches.
  if (p.resolveCodeRepos) {
    p.body.code_repos = await resolveCodeRepos(url, keyFile, p.body.code_repos, p.resolveCodeRepos);
    delete p.resolveCodeRepos;
  }
  // R-BTN-178: `capacity set` reads what the courses' legs require and asks to confirm before
  // the PUT goes out — one name, one thing (R-BTN-137) is the administrator's own statement.
  if (p.preflight) {
    const read = await send(url, p.preflight, keyFile);
    if (!(read.status >= 200 && read.status < 300)) {
      process.stdout.write(`${JSON.stringify(read.json)}\n`);
      return 1;
    }
    if (!(await confirmCapacity(read.json, p.preflight.question, p.yes, process.stdout, process.stdin))) return 1;
  }
  const { status, json, text } = await send(url, p, keyFile);
  // A 2xx whose body is not JSON — an intermediary's login page, an HTML error, an empty body —
  // is a refusal, never success (B-80): the command fails, showing what arrived.
  if (status >= 200 && status < 300 && json === null) {
    process.stderr.write(`baton: ${status} answered no JSON — the request never reached Baton. It answered:\n${arrived(text)}\n`);
    return 1;
  }
  if (role === 'admin' && args[0] === 'open' && json?.url) process.stdout.write(`${json.url}\n`);
  else process.stdout.write(`${JSON.stringify(json)}\n`);
  return status >= 200 && status < 300 ? 0 : 1;
}

// A pipe's write is asynchronous and `process.exit()` flushes nothing, so the command's final
// line could be dropped with its exit already decided — under a loaded consumer (vitest's
// parallel workers) `baton tickets check`'s count line, an answer protocol's last line (B-84's
// class). Wait for stdout and stderr to accept everything, then exit: an empty-string write's
// callback fires once the writes before it are through; the bound keeps a consumer that stopped
// reading from hanging the exit, and stdout's own EPIPE handling keeps a vanished one quiet.
function exitDrained(code) {
  const streams = [process.stdout, process.stderr].filter((s) => !s.destroyed);
  const finish = () => process.exit(code);
  if (!streams.length) return finish();
  let left = streams.length;
  const done = () => { if (--left === 0) finish(); };
  for (const s of streams) {
    try { s.write('', done); } catch { done(); }
  }
  setTimeout(finish, 10_000).unref?.();
}

// argv[1] may be npx's link to this file: compare real paths.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main(process.argv.slice(2)).then(exitDrained, (e) => {
    process.stderr.write(`baton: ${e.message}\n`);
    exitDrained(2);
  });
}
