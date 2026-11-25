---
title: "Proposal: the merge runner, the fact reader, general attestations and the rest of the repository policy's enforcement"
description: "Unbuilt designs moved out of BATON_SPEC §12.8 and §12.9: the policy's dry run, the protection check per forge, proposed tickets, attestations beyond a person's answer, the fact reader, trusted runners and what the merge runner merges, protected paths, hardware human-only keys, trusted consumption of the board, and the out-of-course finding."
---
**Status:** proposal — not built; moves into BATON_SPEC §12 when built (tickets B-136, B-137, B-140, B-141, B-146, B-147, B-263, B-264, B-268)

Each part names the rule of [BATON_SPEC §12](../BATON_SPEC/12-security.md) it would extend. The
rule ids stay defined there and are written here as `R-BTN-n (proposed)`. What is built is the
policy document with its approvers, guarantees and floors, the protection report, human-only
keys, and a person's answer as an attestation (no route sets a grant's role, domain or checker
mark); the
policy's knobs are stored and computed over, and what enforces `merge.*`, `paths.*`,
`tickets.created: proposed` and the `std:` types below is this page.

## 1. Extending the policy's dry run (R-BTN-188, proposed)

R-BTN-188 specifies the built preview. Still proposed are stops for grants whose role the new
`outbox` no longer admits to a class they deliver or whose null domain now counts toward nothing,
queued legs whose requirements the new `attestations` entries admit no writer for, tickets on a
course whose `merge` leg a new `merge.trusted` leaves without a trusted runner, and, for a change
to `repos.unlisted`, the live tickets whose `repos:` entries lose reach (`stops.unreached`).

## 2. The protection check (R-BTN-180, proposed)

`baton repo protect --print <forge>` prints, from the policy's `refs.*` and `paths.control`, the
forge setting that enforces them — and, where the owners' `checks` names a course, the required
status check by name and by the instance's `check_app_id` (R-BTN-115) — and `--check` reads it
back and reports `{matched, reading_hash}`. It does not match while a `refs.*` class the forge
cannot restrict excludes any writer, or while the required check names another App. A change
between runs is detected by comparing each run's reading with the last.

| Forge | What `--check` reads |
|---|---|
| GitHub (an organisation) | the rulesets on branches and tags and their `bypass_actors`, which must be only the identities the policy admits (the trusted runners' App, and the human-only identity); the environments, their reviewers and deployment policies. Rulesets do not cover `refs/baton/*` |
| GitLab | protected branches and tags, and who may push them |
| Gitea, Forgejo | protected branches and tags, and their whitelists |
| plain `git` | the server's `pre-receive` hook, which keeps a pusher log; never a client-side hook |

On GitHub the read needs a credential that could also rewrite a ruleset; only the protection
checker holds it, and no merge runner does.

## 3. Proposed tickets and the proposal merge (R-BTN-180, proposed)

Under `tickets.created: proposed`:

- nothing writes a ticket file on the default branch directly. A ticket a runner's action would create (a condition's handler ticket, R-BTN-161; a
  call leg's child, R-BTN-165; a supersession's replacement;
  not a ticket file a leg writes on its own ticket's branch, which the human's merge of that
  PR files, R-BTN-131),
  and the outbox's git kind (a withdrawal, R-BTN-171), is
  **proposed, not filed**: Baton queues an outbox entry for it, and a trusted-runner deliverer
  writes it on a branch `baton/proposed/<ticket>` from the entry's fields or the creating leg's
  typed output, through the CLI's own templates (R-BTN-171), marks the entry `delivered` with
  that commit, and Baton holds only its filter fields (R-BTN-33). It is not claimable, no leg
  reads its body, and the entry is not `confirmed`, until its file lands. Such an entry is late
  only when it is not delivered within 24 hours;
- **a proposal lands by a proposal merge** (R-BTN-183): the merge runner merges
  `baton/proposed/<ticket>` when every commit on it since the merge base is a deliverer's
  template write for that ticket's entries, touching only the paths they name, and a
  `std:approval@1` whose subject is that ticket at that commit covers exactly those paths and
  blobs. `merge.reviews`, `merge.checks` and continuity do not apply to it; one approval covers
  one proposal;

## 4. Attestations beyond a person's answer (R-BTN-181, proposed)

- **Shape:** `{id, type, subject, value, writer, nonce, lapses_at?, at, revoked_at?}`. `type` is
  a schema id from the shared registry (R-BTN-108). `nonce` is the writer's idempotency key: a
  repeat with the same `(writer, type, subject, nonce)` returns the first `id` and writes
  nothing. A reading has none: it supersedes per `(instance, source, kind)` (R-BTN-76), so a
  repeat is harmless. `value` is validated by the type's schema
  (at most 4 KB). An attestation is in force until `lapses_at`, if set, or until it is revoked
  or superseded. `subject` is one of:
  - **work**: the repository and the ticket, and optionally a commit or a ref, and for a type
    a trusted leg whose action is not idempotent requires, the run (`claim_legs.run`, below). For a
    trusted leg it comes from values Baton holds (the claim's ticket, the head the sync read),
    never from a runner's output;
  - **a resource instance** (R-BTN-76). An attestation about an instance is a **reading**.
- **Any surface.** `POST /v1/repositories/{repository}/attestations` (`baton attestation add`,
  `baton decision answer`, the dashboard; R-BTN-127) takes an attestation about work, and
  R-BTN-76's routes take readings; whether one is accepted depends on the credential alone
  (R-BTN-186). A delegated key writes none (R-BTN-130), and is never `human`.
  `DELETE …/attestations/{id}` (`baton attestation revoke`) revokes one, a human gate for
  `human` ones.
- **Supersession.** A new attestation supersedes an earlier one only when type, subject, writer
  and **attested key** are the same; the attested key is the writer's key, except for a `baton`
  attestation, whose attested key is the runner key it is about. So two runners' reviews at one head coexist, a later `std:ran@1` by one domain never erases another's, and each instrument
  keeps its own latest reading (R-BTN-76). The one exception is the sync's: its attestations
  supersede by type and subject whichever sync credential posted them (R-BTN-191).
- **Bound by subject, not consumed.** An attestation gates every action on exactly its subject:
  a `std:approval@1` names the paths and blobs it approves at a commit, and the merge runner
  merges exactly that head (R-BTN-183), so one approval cannot land two merges and no
  use-once bookkeeping is kept. The rule holds because a trusted leg's action is idempotent on
  its subject: a merge changes the head it names, a deletion removes the branch. A trusted leg
  whose action is not — a sensitive API call — names its run in the attestation's subject
  (`{ticket, head, run}`), so a re-run after a retry or a release needs a new attestation.
- **A prerequisite kind** (R-BTN-120): a leg's `requires.attestations: [{type, subject, writers,
  where?, count?, distinct?, binds?, missing?}]`.
  - `subject` is `work` (the leg's ticket, optionally at its `head`, and `run: this` for a type
    bound to the run) or `instance: <resource>` (the repository's usable instances of it, R-BTN-76).
  - `writers`, optional, narrows the writer classes and `service:<fingerprint>` keys whose
    attestations count. It never widens them: what counts is the policy's `attestations` or
    `readings` entry for the type (R-BTN-188), intersected with `writers` when given.
  - `where` is a list of tests `{path, op, value | leg_input}` over the value, `op` one of `eq`,
    `in`, `glob`, `superset-of`, `gte`, `lte`; `count` (default 1) attestations must hold, with
    `distinct` naming a field they must differ on.
  - `binds` is `gate` (the default) or `advice`. `missing` is `block` (the default for `gate`)
    or `allow` (the default for `advice`): whether no attestation in force, lapsed, revoked or,
    for `requires.resources`, `unknown` (R-BTN-76), blocks.
  - Unmet, it is an `attestation` block, `why` one of `missing`, `other-subject`,
    `writer-not-allowed`, `lapsed`, `revoked`, `failed-where`. A gate's block refuses
    a claim and an advance (rule 1); an advice block is advice, as a `resource` one is (R-BTN-75).
  - `requires.resources` (R-BTN-76) is the short form of an `instance` requirement on
    availability, and takes `binds`, `missing` and `writers` with the defaults `advice` and
    `allow`.
  - The validator refuses a `trusted: true` leg with a requirement that binds as `advice` or
    takes `missing: allow`.
- **Standard types:**
  - `std:wrote@1` (writer `baton`): a writing leg's reported commit range `start..head`, its
    domain and its runner key;
  - `std:ran@1` (writer `baton`): a leg ran the branch's code at `head` in its domain (every
    writing leg, and any leg its course does not mark `reads_only: true`);
  - `std:review@1` (writer `baton`): a review leg the course marks `approves: true` and
    `reads_only: true` ended `approve` at `head`, with its domain;
  - `std:checks@1` (writer `service:<a check-runner's key>`, R-BTN-114): the course's check
    commands, from protected course data, passed at `head` in a check leg's session holding no
    credential (R-BTN-114);
    optional, since the forge's own check runs from the protected default branch suffice for
    `merge.checks` (R-BTN-183);
  - `std:approval@1` (writer `human`): the owner approved `head` with `value {paths, blobs,
    view}`: the protected paths changed, their blob ids, and the digest of the computed view;
  - `std:branch-deletion@1`, and others: the same shape, for other trusted legs.
- **Read from git by the sync, or by a trusted runner.** An attestation that reports what git or
  the forge shows is the sync's (R-BTN-191), counting only where the policy admits `sync` for its
  type, or the fact reader's (R-BTN-192), a trusted runner's `service:` key the policy names. A
  person leg (R-BTN-116) a trusted leg acts on is answered by a `human` attestation.

## 5. The sync's and the holder's attestations (R-BTN-191, proposed)

- **The sync's attestations** ride in the board post (§4.4, `attestations`), each about work (the
  ticket, optionally at a commit or ref), each carrying the run's `observation`:

  | Type | Value | Read by |
  |---|---|---|
  | `std:git.readiness@1` | `{at: {station, path_len}, next: [{leg, state: ready \| waiting, waiting_on?, needs?, course}]}`: the legs leaving `at`, as the station function computed them | R-BTN-70 |
  | `std:git.evidence@1` | `{claim, sha? , url?, found}`: whether git or the forge shows the evidence an unconfirmed end named | R-BTN-10 |
  | `std:arrival@1` | `{leg, reached, next?, ref}`: a fact arrival, `ref` naming the fact | R-BTN-39 |
  | `std:git.implied@1` | `{station}`: where the facts place the ticket, if the course says | R-BTN-39 |
  | `std:decision@1` | a person's answer the ticket shows (R-BTN-116) | R-BTN-116 |
  | `std:git.output@1` | `{leg, run, name, uri, digest?, leg_version?, ref, claim_nonce}`: an output a closing marker lists | R-BTN-82 |
  | `std:git.commit@1` | `{repository, sha}`: evidence an end named, as git shows it | R-BTN-10 |

  A run's attestations are accepted or refused with its post, in its transaction, and replace
  the previous run's of the same type and subject (R-BTN-181's supersession). So Baton never
  judges a ticket from facts of two runs: readiness, arrivals and evidence are always one
  observation's. The post's own authentication (R-BTN-93) is their authentication.
- **A command may carry an attestation.** An `advance` or end moves the lease (the command)
  and carries the holder's `std:arrival@1` for the leg it finishes (the statement), authenticated
  by the request (R-BTN-83). A runner's arrival and the sync's fact arrival are one type, differing
  only in writer: the holder's counts for the leg its claim runs, the sync's or the fact reader's for a leg
  that declares `arrives` (R-BTN-192); any other is kept as evidence and recorded `arrival-unapplied` (R-BTN-39).
- **A deliverer's delivery** is a `std:effect@1` attestation (`{kind, ref, at}`) about the
  entry's ticket, its subject naming the outbox entry, by the runner that delivered it. It moves
  the entry to `delivered` (R-BTN-171); the entry is confirmed by the sync's later attestation
  that git or the forge shows the effect.
- **Superseded per writer class.** The sync's attestations supersede by type and subject
  whichever credential posted them (a sync key, the CI identity or a machine key, R-BTN-62,
  R-BTN-93), so a repository's posting credentials never leave two runs' facts side by side;
  where `inputs.board` admits `machine`, a granted machine key's post therefore replaces the
  CI sync's facts as fully as the CI sync's replaces its.

## 6. The fact reader (R-BTN-192, proposed)

R-BTN-192 (proposed) — the fact reader: forge facts a trusted runner attests, with no course code.
Where the policy admits no `sync` writer for `std:arrival@1` (R-BTN-191), a fact leg's arrival
comes from the **fact reader**: a mode of the home's merge runner (R-BTN-182) that reads
the forge through the CLI's own fact adapters (R-BTN-96) and runs no repository code.
- **The kinds** are R-BTN-203's, read the same way, except `pr-verdict`: under a policy that
  admits no `sync` writer for `std:arrival@1`, only the human-only identity's verdict counts, the
  forge user the policy's `human_identity` names (R-BTN-188, R-BTN-185), since runners push their
  own branches.

- **What it reads.** Baton tells it which tickets wait: `GET /v1/repositories/{repository}/
  fact-legs`, every live ticket with a leg leaving its station that declares `arrives`, with the
  station, `path_len`, the leg, its kind and the instant the leg began waiting. It reads only
  those, and only the kinds they name.
- **When.** Each minute while that list is not empty, and at once on a doorbell ring `facts`
  (R-BTN-91) that Baton sends when a ticket joins the list or a forge notification arrives for
  a repository with one (R-BTN-73).
- **What it writes.** An `std:arrival@1` per fact found, its `ref` as the table says, as its
  `service:` key, through `POST /v1/repositories/{repository}/attestations` (R-BTN-181); R-BTN-39
  applies it. The key counts only once the owner names it in the policy's `attestations` entry
  for `std:arrival@1`, as a check-runner's key is named for `std:checks@1` (R-BTN-188).
- **None named.** A repository whose policy admits no `sync` and no named fact reader for
  `std:arrival@1`, while its registry lists a course with a fact leg, raises
  `baton.fact-reader-missing`, a `notify` condition closed when a key is named; its fact legs
  then arrive only by adopt (R-BTN-39).
- Under `cooperative` the sync's station function may attest the same kinds, and any fact a
  course reads, as `sync`; the fact reader is optional there.

## 7. Trusted runners (R-BTN-182, proposed)

R-BTN-182 (proposed) — trusted runners. A grant role (R-BTN-180) that claims only legs its course
marks `trusted: true` (`merge`, branch deletion, sensitive API calls, each idempotent on its attestation's subject, R-BTN-181) and holds the only
non-human credential able to perform that leg's action. No other runner is offered a trusted leg
or may claim, advance or end one (rule `trusted`), and neither is a grant marked `checker`
(R-BTN-180) or a runner that delivers `forge-check` (R-BTN-115).
- **It runs no repository code but a trusted leg's override**, which it runs through its
  executor as any leg's code (R-BTN-107), delivering the outbox included (R-BTN-171).
- **It re-checks at the moment it acts**, against Baton's record: every attestation it relies on
  is read from Baton over its authenticated connection, its writer's key unrevoked and admitted
  by the policy in force, and its subject compared with the exact object acted on — the head,
  the paths, the blobs. It trusts Baton for what Baton recorded (§12.8) and trusts no runner's
  board post, webhook or runner's output for what it acts on (R-BTN-187); the head the sync read
  it re-reads from git before acting (R-BTN-183).
- **A course's `legs/<leg>.run.mjs` for a trusted leg may only add refusals.** It runs as any
  leg's code does, through the runner's executor (R-BTN-107), with the computed diff as its only input, and returns `{refuse, reasons}`, `reasons`
  from a closed list with path ids. The CLI applies R-BTN-183 afterwards, whatever it returns.
- While `no-runner-lands` is broken for a repository (R-BTN-189), every trusted runner stops
  acting on it, except the protection checker.

## 8. What the merge runner merges (R-BTN-183, proposed)

R-BTN-183 (proposed) — what the merge runner merges. At the PR's exact head `H`, under the policy's
`merge` and `paths` (R-BTN-188), except a proposal merge (part 3):
- **A domain that runs a branch's code is one of its writers.** Every `std:wrote@1` and `std:ran@1`
  domain of `H`'s chain is a writer domain. A review leg is one its course
  marks `reads_only: true`; `std:ran@1` follows from the course's declarations, since Baton cannot
  observe what a leg ran (§12.8). The runner's harness starts a `reads_only` leg's agent with no
  `--auto` or permission bypass and no configuration from the branch (B-141).
- **Continuity.** A writing claim reports its start head at claim, which must be the last
  attested head (or the merge base for the first leg). The CLI refuses to build on any other tip
  and raises `baton.foreign-commit`. At `advance` the leg reports `start..head` from the objects it
  pushed and verifies the remote equals them; its own intermediate pushes inside that range are
  its own. Commits reachable from the default branch (a merge of main into the branch) are not
  part of any range. A rebase replaces the range: the leg that rebases reports the new one. Who
  wrote a commit is what the chain of ranges says; commits carry no signature Baton requires. Review rounds go to the
  PR conversation or, on a `git` repository, to the ticket's leg-state branch, never to the work
  branch (R-BTN-190), so a reviewer never becomes a writer.
- **Independent review.** `merge.reviews.count` `std:review@1` at `H`, each from a domain other
  than every writer domain of `H` and from a review claim that started at `H`, no two from one
  domain, runs compared as R-BTN-180's *How runs compare* says. A chain any of whose
  `std:wrote@1` or `std:ran@1` carries a null domain never merges while `merge.reviews.count` ≥ 1:
  a writer nobody labelled cannot be told from its reviewers.
- **Checks**, under `merge.checks: required`. Check runs whose workflow file is on the protected
  default branch with the same blob as at merge time, concluded `success` at `H` (never `neutral` or `skipped`); or a `std:checks@1` at `H` where the owner named its writer
  (R-BTN-181, R-BTN-114). Commit statuses are never read. Checks show that the change's own tests
  pass; they are not a security gate.
- **Paths.** The changed paths are `git diff-tree -r -z --no-renames --name-only` from the default
  branch's tip to the merge result, plus each `merge-base --all` diff. A symlink or submodule entry
  (modes 120000, 160000) or a `.gitmodules` change anywhere is refused. Paths are matched as `p`
  and `p/`, case-folded and NFC-normalised, against the protected paths.
- **Protected paths.** Under `paths.control: human`, a control path never merges here; under
  `trusted-runner`, it merges only with a `std:approval@1` as a ticket path does (R-BTN-184).
  Under `paths.tickets: approval`, a ticket or goal path merges only with a `std:approval@1` at
  `H` whose `paths` and `blobs` cover every protected path changed,
  and whose blobs equal those paths' blobs in the merge result; the own-progress exception aside.
  Main moving does not void an approval unless it changes an approved path.
- **How.** Squash or merge at exactly `H`, with the base pinned too (a compare-and-swap push of
  the merge result onto the main tip it was computed from), and a commit message the merge runner
  writes itself, carrying no trailer from the branch. A branch that moved since an attestation was
  made is refused, and the ticket returns to the leg the course names. The leg's end names
  the merge result as its `ended_at_sha` (R-BTN-8), a commit sha always: §12.9 accounts for
  the push by it.
- **Leg state** (R-BTN-190). A work branch whose merge result, or any commit in the ticket's
  ranges, holds an entry folding to `.baton-legs` is refused.
- **Foreign commits.** A commit on a ticket's branch that no claim of that ticket reported is found
  by the trusted runner from git, not from webhooks. It resets the
  branch to the last attested head and raises `baton.foreign-commit`, an `owner` resolution, not a
  human gate, so a cheap push cannot cost a hardware-key ceremony.
- **Source pins** (R-BTN-134) are accepted only at a commit on the source's first-parent history or
  a release tag.

## 9. Protected paths (R-BTN-184, proposed)

R-BTN-184 (proposed) — protected paths. The policy's `paths.protected` (R-BTN-188), with a floor no
course or owner removes. Baton computes what it can and fails closed on the rest:
- computed: `.baton/**`; every path `.baton/baton.json` lists in `imports`; the items glob and goal
  glob the ticket source declares in `baton.json`; `.github/**` and every local path a workflow `uses`; `CODEOWNERS` and `docs/CODEOWNERS`;
  agent configuration for each
  supported harness, at any depth (Claude Code: `**/.claude/**`, `**/CLAUDE.md`,
  `**/.mcp.json`; Codex: `**/.codex/**`; opencode: `**/opencode.json`, `**/.opencode/**`; and
  `**/AGENTS.md`); package-manager and environment
  configuration (`**/.npmrc`, `**/.yarnrc*`, `**/.envrc`). A glob is matched against a path normalised
  as R-BTN-183 normalises one (case-folded, NFC): it is anchored at the repository root
  unless it begins `**/`, which is any depth, the root included; a trailing `/**` is
  everything beneath, and `**` alone every path; `*` is any run of characters within a
  segment;
- declared by the owner: authority documents as whole files (the context corpus, `lessons`, the
  spec), and what deploying or releasing workflows execute. A repository whose workflow uses a
  secret in a deploy or release environment is protected `**` until the owner narrows it.
Two classes:
- **Control paths** (all but tickets and goals): landed as `paths.control` says. Under `human`
  they are never merged by a trusted runner: the leg ends at `human-merge`, showing the human the computed view of `H`: the chain, the reviews, the
  checks and the diff. A human lands it; the fact reader recognises the human's merge by reading
  the forge (the merge's actor equal to the policy's `human_identity`, R-BTN-188, or the pusher
  log) and attests it as the `pr-merged` arrival of `merged-by-hand`, which leaves `human-merge`
  (R-BTN-131, R-BTN-192); Baton records a `pr-merged` whose merge commit is not the presented
  `H` as a discrepancy (R-BTN-85), the arrival applied all the same. Under `trusted-runner`, the
  merge runner merges them with a `std:approval@1`; under `any`, they merge as any path does.
- **Tickets and goals:** under `paths.tickets: approval`, merged by the merge runner with a
  `std:approval@1` (R-BTN-183), or by the human's own merge of a ticket's PR or a request PR
  (R-BTN-131).
- **A leg's own progress** needs no approval: a claim's branch may append to its own ticket file,
  at the exact path Baton's claim names, when the change is bytes appended at the end of a file
  whose base ends in LF, compared as blobs without rename detection, with no mode change, after the
  file's last line `## Status` (LF, outside code fences, present at the merge base). A file without
  one takes no progress. Each entry is one line, `- <UTC time> <leg> <claim nonce>: <text>`, the leg
  and nonce equal to the claim's and the time within its span; the text at most 300 bytes of
  letters, digits, spaces and `.,;:-'()?!`, no URL; at most 20 entries per claim. Readers show these
  lines as the leg's data. Anything else in a ticket file is a ticket change. A done ticket's move
  to the archive, setting `status: done`, is a templated change the merge runner makes; a record
  course's ticket makes it on its own branch (R-BTN-131).

## 10. Hardware human-only keys (R-BTN-185, proposed)

Under `human_key: hardware` Baton accepts only a hardware-backed key requiring PIN and touch
(`verify-required`) whose FIDO attestation matches an allowlist of authenticators.

- **What is signed is shown first.** The CLI prints the canonical fields and the computed view
  before signing. Under `human_key: hardware`, it also requires a short code derived from them,
  typed on the machine the key is plugged into. The dashboard may only prepare an approval that the
  CLI signs; a WebAuthn assertion is a human gate only with an authenticator registered by a
  `human_only` signature, attested and allowlisted under `hardware`.

## 11. Trusted consumption of the board (R-BTN-187, proposed)

Observation and board post limits are in R-BTN-187. Additional concurrent claim limits are
proposed, so one key cannot freeze the leases.

Where the policy's `inputs.board` excludes `machine` and its `attestations` entries admit no
`sync` writer for `std:arrival@1` or `std:decision@1`: what a protection depends on (changed
paths, foreign commits, a human's merge) is read from git and the forge by trusted runners, never
from a board post; and the stations a trusted leg acts on are reached from attestations by
writers the policy admits, never from the sync's attestations of verdicts, trailers or comments
read from git.

## 12. A control path changed outside a course (§12.9, proposed)

A third report beside §12.9's two. An agent session acting with the human identity's forge
credential is one the forge cannot tell from the human: Baton shows its control-path push as an
`out-of-course` finding when the push is no ticket's merge, and stops nothing.

- **A control path changed outside a course.** While the policy's `paths.control` is not `any`
  (R-BTN-188), Baton checks every recorded push delivery (R-BTN-73) to the default branch
  against what it knows landed it, from the delivery's own record: no repository content is
  read.
  - **Which paths.** The added, removed and modified paths of the delivery's commits, judged
    by the globs of R-BTN-184's computed floor that name a path outright — every computed
    entry but `imports`, the ticket source's globs and a workflow's `uses`, which are read
    from files. The owner's `paths.protected` is not judged here, so a repository protected
    `**` raises no finding for its ordinary merges.
  - **Accounted.** A delivery is accounted by a record Baton holds that names the delivery's
    head commit, made before the delivery comes in or at any time after, for a ticket whose
    scope covers the repository: the commit a claim on a `trusted: true` leg reported at its
    end (`claims.ended_at_sha`, R-BTN-183), from a runner whose grant on the pushed repository
    is `trusted-runner`; or the `ref` of a `pr-merged` arrival (R-BTN-192) written by the fact
    reader's `service:` key the pushed repository's policy names, never by `sync`. Nothing
    else accounts: not an open claim, not an arrival naming another of the delivery's commits,
    not a record from a runner or a fact reader another repository's policy admits.
  - **The finding.** A delivery that changes such a path and is not accounted when it comes in
    opens an `out-of-course` finding, logged `out-of-course`: its target the delivery's head
    commit, its detail the pusher's id and login, the delivery's commit ids and at most sixteen
    of the paths with the count of any beyond them. A delivery recorded `truncated` opens one
    with no path. There is at most one finding per head commit, open or closed: a redelivery
    opens nothing.
  - **Closed.** A record that accounts for the head closes the finding, `resolved_by` `baton`,
    logged `scope-resolved`. An owner resolves one only once it is listed (`not-found` before).
  - **Listed late.** The finding is under Needs you only once 15 minutes have passed since it
    was raised, by Baton's clock (R-BTN-32), compared at each read: a merge the fact reader
    attests within its minute, or a merge leg reports at its end, is never listed. It reads
    `<pusher> changed <paths> at <commit>. This was not a course's work.`, `<paths>` reading `unrecorded paths` when the finding names none.
  - **What it does not see.** A change whose head is the merge of a ticket's pull request,
    made by hand: the fact reader attests that merge whatever it carried, from any station, so
    a change pushed onto a ticket's branch, or beneath its merge commit, is not shown. The
    finding shows the push that is no ticket's merge at all; it is no defence against a session
    that hides one. Nor does it see a push whose
    delivery never reaches Baton, a forge whose pushes Baton holds no record of (R-BTN-194), or
    a forced push back to an older head, which names no path. Under `paths.control: any`
    nothing is checked (R-BTN-66).
  - **Information only.** Nothing is refused, held or reverted, and `scope_policy` does not
    read it.

The findings list of §12.9 lists an `out-of-course` finding as *Listed late* says, until an owner
resolves it.

The runner's audit report (§12.9) would carry two more kinds, `pr` (opened or commented on) and
`egress` (a host reached). The runner has no source for either, and no host scope is defined;
each arrives with its source and the scope for it.

## 13. Readings counted for a requirement (R-BTN-76, proposed)

Moved from BATON_SPEC §6.3; it joins §4's prerequisite kind. For a requirement on an instance,
each admitted writer's latest observed reading in force on each usable instance, of either kind,
is one attestation, whatever the instance's state, and `count` counts distinct writers' keys
unless `distinct` names another field. A `resource` row gates only where its requirement binds
`gate`, and R-BTN-181's supersession, binding and `missing` apply to a reading as to any
attestation.
