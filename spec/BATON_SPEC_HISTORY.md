# Baton specification — history

This file holds the history of `spec/BATON_SPEC.md`. The specification itself states only what is
true now: one current rule per fact, with no dates, amendment notes, rationale beyond a clause, or
retired rules. What it no longer says is recorded here: the dated amendments that shaped it, the
requirements, scenarios and gates it retired, how its old sections map onto the current ones, the
transitions the implementation still carries, the decisions in full and the review record. Git
keeps every earlier text of the specification; the last amendment-annotated version is the one
before the 2026-10-20 rewrite.

`npm run check:spec` reads this file's **Retired requirements** table: code that still cites an id
listed there gets a warning, not a failure, so it can be cleaned up separately.

## Changelog

- **2026-10-13 — approval.** The specification was approved after a claims-truth review and five
  adversarial and final review rounds (Review record), owned by project `baton`, items
  R3-1205–R3-1221. It moved the factory's live claim state off git into a Cloudflare Durable
  Object: fenced leases, sidecar heartbeats, reaping, confirmation of ends by later snapshots,
  activities and transcripts, a git mirror that never records the holder, and a one-way cutover
  (R-BTN-1–R-BTN-36). The owner named the system Baton and ruled that the home repository is
  authoritative ("git says that a ticket is claimed and when, Baton says by whom"). Rules
  introduced: R-BTN-1–R-BTN-36, including the retry policy R-BTN-23 (merged into R-BTN-122 by
  this rewrite).

- **2026-10-14 — §2a–§2f, §6.12, §6.13, §7.3 (owner direction).** Baton stopped being tied to one
  repository or one kind of work: registered repositories and courses (§2a, "course", "leg" and
  "station"; "work item" became "ticket"), the boundary between Baton and a course (§2b,
  R-BTN-50 — capacity, provider and model logic are the course's, never core's), hooks and probes
  with a trust model (§2c, R-BTN-51–R-BTN-54), courses that change without Baton (§2d, "a minimal
  core so projects and agents iterate on courses without changing Baton"; R-BTN-66: Baton does
  not replace or fortify git's security model), the course file (§2e), ticket sources and the
  CLI's defaults (§2f), the ticket as a course of legs that suspends at stations (§6.12), the
  runner (§6.13), Baton as an advisor that gates only safety (R-BTN-45), SSH-key identity
  (R-BTN-13), hosting on Cloudflare and locally (§3a, R-BTN-55–R-BTN-59), administration by
  deployment-anchored administrators and repository owners (§10.6, R-BTN-57, R-BTN-58),
  cooperative locks with detection (R-BTN-46) and a checked Quint model (R-BTN-68). The
  `roadmap-pr` course's provider logic moved to docs' `BATON_ROADMAP_PR_COURSE` with its gates
  G-BTN-28–30, -34, -45, -46, -48, -52 (and later -65). Reviewed adversarially six times the same
  day; the host moved from `workitems.immediately.run` to `baton.immediately.run`. Rules
  introduced: R-BTN-37–R-BTN-74. Retired: the lease-until-done-or-hand-off design, vendored
  `locate`, per-advance vouches, `required_tags` and the reference repository.

- **2026-10-15 — §2g–§2j (owner direction).** Blocks answered from an index (§2g: "it must be
  cheap to ask whether and why a ticket is blocked … and to be told on unblock"; R-BTN-75–R-BTN-80,
  decisions as a fourth kind of block, leg queue bounds as warnings, notices and couriers);
  positions, history, contracts and replay (§2h: "the edges of a graph connect nodes, not other
  edges"; R-BTN-81–R-BTN-85); child tickets, the capacity envelope and owner-state export (§2i:
  "tickets are sequential, children are the parallelism"; R-BTN-86–R-BTN-88); time on legs and
  the push doorbell (§2j, R-BTN-89–R-BTN-91). `/v1/worker/*` became `/v1/runner/*` with no alias
  (R3-1261). Rules introduced: R-BTN-75–R-BTN-91.

- **2026-10-16 — §2k, §2l (owner direction).** §2k: Baton runs without GitHub — forges, sync
  keys, pulled syncs, per-forge notifications and the `branch` course (R-BTN-92–R-BTN-97,
  R3-1253; "Baton should run equally on GitLab, Gitea or a plain shared git repository"). §2l,
  revised after two adversarial reviews the same day: Baton runs no repository code ("Baton only
  accepts and delivers state") — hooks retired, workers rank from fleet and instance views,
  claims name preferences and the accounts they bill, readings kept per instrument, a machine key
  trusted to sync and report, worker couriers, open-world claims and a passive plain git server
  (R-BTN-98–R-BTN-105). Retired: R-BTN-52, R-BTN-54, R-BTN-59, `hooks.js`, `HookRunner`, the hooks
  table, `hook-failed`, `hook-refused`, the recommendation cache, `launch-advice`, matching rule
  12, the three-phase claim, `allowed_instances`; scenarios S-BTN-29, S-BTN-35 and gates G-BTN-54,
  G-BTN-60.

- **2026-10-17 — §2m (owner direction).** The runner organizes a ticket's legs and sessions report
  to it (R-BTN-106); cloud sessions as runners (R-BTN-107); one envelope and named schemas for
  outputs and readings (R-BTN-108); station entry requirements (R-BTN-109); standard formats
  (R-BTN-110); signatures (R-BTN-111); declarative views (R-BTN-112); session links (R-BTN-113);
  check courses and the forge courier (R-BTN-114, R-BTN-115); person legs (R-BTN-116);
  registration tokens and API keys (R-BTN-117 — "requiring ssh for runner auth is not great");
  streaming over `wss://` (R-BTN-118 — "we don't need hand-rolled encryption for streaming logs");
  stopping a leg (R-BTN-119); prerequisites in one place (R-BTN-120); capability types
  (R-BTN-121); retry policies per leg (R-BTN-122); fresh context, the `epic` course and decision
  severities (R-BTN-123–R-BTN-125, after a comparison with Gas Town); a blocked edge (R-BTN-126 —
  "not a new station … simply a colored edge"); the noun-verb CLI and leg logs (R-BTN-127,
  R-BTN-128); one action registry and MCP (R-BTN-129, R-BTN-130). The specification moved from
  docs to this repository unchanged (R3-1252). The model check moved from CI to the author's
  machine (R3-1254).

- **2026-10-18 — §3b, §10.7 (owner direction).** §3b (built by B-45, revised after review gate
  rounds 1–5): a tenant is a Baton named by its origin and served only there; nothing crosses a
  tenant; many tenants later is a router (R-BTN-135); operator settings, secrets and
  administrators per tenant (R-BTN-136); a credential valid in one tenant, a runner bound to one
  origin (R-BTN-137); forge repositories named by immutable ids (R-BTN-138). §10.7 (after the
  security review, built by B-46): only pushers' writes count (R-BTN-139); code repositories as
  the owners' list and a branch-pattern grammar (R-BTN-140, R-BTN-141); bars name legs literally
  (R-BTN-142); runners run only default-branch code, scrub credentials and stop every process
  (R-BTN-143–R-BTN-145); multi-repository keys sync by opt-in (R-BTN-146); unfounded heads and
  tighten-only held posts (R-BTN-147); open-world gates (R-BTN-148); caps (R-BTN-149);
  observation takeover (R-BTN-150); bounded readings (R-BTN-151); views as data (R-BTN-152); merge
  checks from an exit status (R-BTN-153); MCP holds that only add (R-BTN-154); sign-in by a
  confirmed code, replacing one-time login links (R-BTN-155); CI-token and notification checks
  (R-BTN-156); tokens, roles and links (R-BTN-157); the App manifest, untrusted text, the local
  host and import (R-BTN-158). Owner decisions: a multi-repository key opts in, a check verdict is
  an exit status, MCP only adds a hold and stops a leg, the local host binds loopback, GitLab's
  "can push" is Developer (30).

- **2026-10-19 — §2n–§2p.** The `build-app` standard course (R-BTN-131, B-40). One primitive per
  kind of prerequisite (§2n, R-BTN-132, B-41 — the owner asked to "verify that we do not have a
  set of overlapping primitives for legacy reasons"): `blocked_by`, `operator_only` and the
  reserved `waiting_on` labels retired behind a dual-read window, fan-in moved to the leg. SSH or
  API keys at the holder's choice for administrators, owners and runners (R-BTN-159 — "use both
  ssh keys and api keys for authentication"). A leg runs in a checkout of its commit, in
  TypeScript or JavaScript with Node's own resolution (§2o, R-BTN-133, B-42). Courses are read
  from their sources and the CLI ships none (§2p, R-BTN-134, B-43 — "baton CLI should not assume
  it has the correct version of a course"). Retired: the CLI course registry, B-33's own-commit
  and byte-equal checks, `--eject stations`; S-BTN-105 and G-BTN-124 were reduced to their
  override half.

- **2026-10-20 — §2q (owner direction).** Conditions raised by any leg, typed, declared and of
  three dispositions, replacing error types (R-BTN-160); bound dynamically to handler courses whose
  tickets are files (R-BTN-161); a suspended leg that waits in its claim and then resumes with a
  restart (R-BTN-162); the debugger for unhandled conditions and core's own `baton.*` conditions
  (R-BTN-163); no notices for people (R-BTN-164); call legs with completion tables (R-BTN-165);
  choice stations settled by Baton's clock (R-BTN-166); timers (R-BTN-167); compensation and
  supersession (R-BTN-168); the standard handler courses (R-BTN-169); and a dual-read window
  (R-BTN-170). The owner's direction: delivering a question to a person is project-specific and
  must be "a course like any other"; adopt the Common Lisp and BPMN concepts "in one go". Retired:
  notices for people, personal channels, worker couriers and their pool, `remind_after`, severity
  routing, `error_types`, Baton-raised decisions (`baton:retries`, `baton:contract`,
  `baton:stalled`), `max_duration`, `max_ready_s`, `max_attempts_s`, the 72-hour stall decision,
  and hand-built spawn-and-fan-in; R-BTN-103 and R-BTN-80's notices for people. The same day the
  owner moved model checking off hosted CI entirely ("I want to run it locally") and made the
  full check weekly ("3 hours is absurdly long").

- **2026-10-20 — leg queues built (R3-1255).** `leg_queues` gained `max_queue`, the bound last
  judged, so a course file that lowers or raises a bound is a crossing like a ticket's; and
  `leg_queue_members` is keyed by ticket, each ticket counted in one queue. The queue-over payload
  names its `course`, since a leg name is unambiguous only within one.

- **2026-10-20 — this rewrite (owner direction).** The specification was rewritten "as if it were
  the only version": organized by concept with new section numbers, history moved to this file,
  and every concept no longer needed removed rather than annotated. Ids were kept; merged rules
  carry both ids in their heading (R-BTN-122 / R-BTN-23, R-BTN-76 / R-BTN-151). Changes of
  substance:
  - Baton gets no git or forge credential: its intended git writes — handler tickets of its own
    conditions and the withdrawals `baton.cancel` writes — go through an outbox that runners drain
    with the built-in leg `baton.write` (new R-BTN-171). This retires the `conditions` ticket source
    and `GET /v1/sync/choices`; a choice or timer settlement is held as an override until the
    station changes and the winning leg's run writes its marker.
  - Retries are the built-in default handler of `error` conditions; binding `error.<type>` to a
    course is an open question.
  - `baton.` replaces `baton:` in core condition names; every "listed under Needs you" is a
    `notify` condition `baton.<sub>`.
  - The handler course for warnings is `announce` (the disposition stays `notify`).
  - `select: "children"` is retired; fan-in over children is a call leg. `epic` is two call legs
    (`plan`, `replan`) with a `closed: true` completion; `baton.call-empty` is gone (a `spawned`
    end naming no children is refused).
  - The duplicate gate id G-BTN-145 for R-BTN-159 became G-BTN-155; new S-BTN-136 and G-BTN-156
    cover the outbox.
  - Retired: R-BTN-41 (to docs), R-BTN-164, R-BTN-170; transition machinery moved to
    **Migrations the implementation still carries**.

- **2026-10-20 — one evaluation per transaction built (B-49, baton#67).** baton#59's review found
  core's recount evaluating after the capability rows and again after the resource rows, so a
  ticket blocked on both whose fleet returned was logged `unblocked` and `blocked` again with a
  new `blocked_since`. R-BTN-77's lost answer now also silences a transition whose cleared rows
  include a lost one on the queued leg, whatever else cleared; S-BTN-45 gained ticket K.

- **2026-10-21 — leg logs in the owners' bucket (owner direction).** A git transcript
  repository grows without bound, since every clone carries every log, and a log cannot be deleted
  without rewriting history; a storage bucket is elastic. R-BTN-128 now has the runner write each
  `process`-mode run's masked output as create-only JSON-lines chunks, plus a closing `end.json`,
  to `<leg_log_root>/<repository>/<ticket>/<leg>/<run>-<claim>/`, where `leg_log_root` is an
  owners' `s3://` or `gs://` URI, or `file://` on the local host. Runners and readers use their own
  ambient credentials (the AWS default chain, Application Default Credentials). Baton stores only
  the run's directory: the owner's direction was "baton only needs to store the URI of a directory
  within a storage bucket (or local file path for a locally running instance)", and that it is
  "OK if logs cannot be viewed from the web app for now". `baton leg log -f` follows a running leg
  by polling for the next chunk, so the live relay through Baton (R-BTN-118: the `Stream` port,
  `/v1/ui/stream`, `/v1/runner/stream`, `/v1/stream`, the `watch`/`unwatch` rings) is retired,
  along with the `leg_logs` setting and pointer table, `leg_logs_repo`, the pointers on heartbeat,
  `advance` and `end`, and `leg-log-push-failed` (now `leg-log-write-failed`). None of it was built
  (B-9, B-23 and B-76 had not started).

- **2026-10-22 — §5.9 and §6.10: the capability ontology and choices (owner direction; B-104,
  B-105).** The owner: "credentials are capabilities: an anthropic api key is what enables a
  runner to execute an opus review", and "Baton should never store the credentials, but it needs
  to keep track of the ontology of how credentials map." Legs should require a high-level
  capability (`code-generation-llm`), while runners know which keys and harnesses they hold. The
  design went through these iterations, first in the tickets and then in this spec:
  1. **Positive Datalog over flat strings** (B-104 as filed). Each rule was a conjunction of
     capability names deriving one name. Closure ran server-side at matching, and every cycle
     was refused. The format was JSON with a documented 1:1 mapping to N3 ("let's not reinvent
     the wheel"; "JSON-with-N3-mapping sounds like a reasonable compromise").
  2. **A built-in ontology and value bindings.** The owner: "baton should come with a reasonable
     ontology built-in, any fact of which can be overridden on the repository level". Bindings
     (`coding model = claude opus 5.5`) became joining facts, and the owner's two-dimension rule —
     "capability:coding model → credential:provider offering coding model AND harness usable with
     coding model" — needed variables. The N3 mapping was promoted to the semantic reference.
  3. **ASP-Core-2 as the one language.** On standards risk the owner wanted "a uniform ontology
     language", because "complexity creeping in raises the risk that we start deviating from
     standards in ways which will prevent adoption". ASP-Core-2 covers derivation (Horn rules),
     guards (default negation) and preference (weak constraints), so N3 was demoted to an interop
     note. The runtime was split from conformance: the sync was to compile a graph and ordered
     lists, core was to run a ~50–100-line reachability and first-match evaluator, and clingo was
     to check conformance in CI.
  4. **Preferences** (B-105). The owner: prefer DeepSeek from DeepInfra during OpenCode Go's
     peak, falling back to OpenCode Go if DeepInfra is unavailable; and use Opus as the second
     reviewer "unless my Claude subscription is nearing its 5-hour limit", falling back to GLM.
     Ordered alternatives with guards were resolved at the claim and delivered as advice.
  5. **Readings as atoms, no provider vocabulary in core.** The owner: "I don't want Baton core to
     have to have hardcoded support for various model providers… A completely new model provider
     and model-choice logic implemented in a repo using baton, without any baton modifications."
     Instruments' readings, against schemas that extend a base capacity schema, became atoms that
     the guards read.

  An adversarial review of iterations 1–5 (Review record, 2026-10-22) found 36 issues, 12 of them
  blocking. Its verdict was that the direction was sound but the design was not executable: the
  fragment was never pinned down; a general join needed more than graph reachability; hysteresis
  needed state; fractions do not exist in clingo; readings belong to instances; and the safety
  boundaries (rule heads, bounds, strata, grant order, a derived route's credentials) were not
  drawn. The owner settled the four forks, and the rework wrote the result here as R-BTN-174 to
  R-BTN-177:
  - core runs a **bounded general evaluator**, about 300–400 lines, not compiled fixed shapes;
  - the language **grows only in directions ASP-Core-2 allows**, so a binding narrows by default
    negation inside the ontology and never through a preference;
  - **hysteresis reads a stored last demotion**;
  - **reading atoms come from administrators and instrument keys** unless a resource admits
    runners.

  Asked whether another Datalog extension had better TypeScript tooling, the rework found none
  that is a standard with preferences. So the conformance oracle became `clingo-wasm` in `npm
  test`, replacing a pip-installed clingo job. Rules introduced: R-BTN-174 to R-BTN-177;
  S-BTN-139 to S-BTN-154; G-BTN-159 to G-BTN-161. Amended: R-BTN-69 (a leg's `choices`), R-BTN-75,
  R-BTN-76 (`atoms_from`, a `std:` base), R-BTN-100, R-BTN-110 (`std:api-capacity@1`), R-BTN-121
  (`derived` types), R-BTN-144 (`via` and alternative credentials, `BATON_ADVICE`,
  `BATON_ROUTE`) and rule 4. The drafts' superseded ideas never entered this spec, and are
  recorded under Decisions in full: the N3 mapping, the compiled runtime and its line estimate,
  refusing every cycle, hard-coded functional bindings, guards that drop an alternative, fractional
  thresholds, and peaks read from provider tables.

  A second fresh review of the written sections (Review record, 2026-10-22, round 2) found 4
  blocking and 15 should-fix findings, and the sections were rewritten:
  - the gate stratum is made monotone by forbidding negation over anything that depends on
    `holds`, not only over `holds` itself;
  - the encoding's predicates are reserved;
  - the ontology is opt-in, through `.baton/ontology.json` naming a versioned built-in;
  - an alternative `needs` capabilities instead of naming a model and a credential, so core
    keeps R-BTN-50's boundary;
  - hysteresis is per runner;
  - the choice state and `blocked` hear only permitted sources;
  - stale derived sets are re-evaluated at a claim;
  - `via` is every holding a derivation rests on, independent of evaluation order;
  - a dead credential ends a leg through R-BTN-126;
  - the clingo assertions are corrected against clingo-wasm's actual output.

  A third fresh review (round 3) found 1 blocking and 15 should-fix findings. Most came from
  over-specification, and the fixes simplified the design rather than adding to it:
  - why-not and the credentials a derivation gives a leg now both read one **canonical proof**
    per atom. The evaluator is fully determined, so this is the instance that first produced the
    atom. It replaces a set-minimizing fixpoint and a backward walk, neither of which was well
    defined.
  - The gate bound no longer claims monotonicity of work: runtime gets twice validation's
    budget.
  - Choices are resolved at the `advance` that starts a leg, since a claim runs nothing.
  - Courses and the program are accepted in a fixed order, and a stale program cannot outlive a
    course change.
  - Program changes are rate-limited, and the alarm's budget is shared round-robin between
    repositories.
  - Field atoms come from the latest reading that carries a `detail`.

  A fourth review (round 4) raised two blockers that were design questions, and the owner
  settled both:
  - **Grants against derivation.** An agent could mark a type derived and derive a capability a
    grant withheld. The owner: "Runners can work on whatever they choose… Baton has no way to
    enforce worker activity. Deriving "vpn:corp" when a runner doesn't have it leads to
    self-sabotage… There are many other ways a runner could sabotage itself or the whole
    project." Derivation therefore stays past the grant.
  - **Credential scoping.** The design passed credentials to legs by proof and by choice, which
    contradicted R-BTN-144, since model-provider keys are kept for every leg. The owner: "Once
    the credentials are in the sandbox, an agent running in the sandbox will be able to access
    them even if the runner does not explicitly pass them to the agent. It seems
    counterproductive to build security theater for this. A better mitigation is to keep model
    provider credentials out of the runner's sandbox by using a bifrost or litellm proxy… but this
    is not baton's responsibility."

  So the ontology and choices pass no credential. Provider keys are plain `key:` labels, and the
  canonical proof serves only why-not. That removed the round's ordering and fallback findings
  with it. The other fixes:
  - course files' ontology parts and the program are accepted as one unit;
  - the evaluator's input is restricted to the program's constants;
  - guards read capabilities only through `has`;
  - a request's re-evaluations are capped;
  - the why-not walk is deduplicated;
  - `atoms_from` is judged per instance.

  After round 5 the owner stated Baton's responsibilities, and the statement was refined in
  discussion: "Baton is an advisory lock server and capability, instrumentation and message
  tracker. It does not enforce or directly verify work performed by runners, nor does it assign
  them permissions or capabilities." Pushed back on and agreed:
  - the lease stays authoritative for every worker that uses Baton;
  - grants and roles are access control over Baton's own state, not permission over the work;
  - adoption, not each worker's obedience, is the optional part.

  The owner added three points:
  - "human-operator is a self-proclaimed capability of a runner. Baton can't verify a runner is
    actually human-operated";
  - "gates protect the lock, not the work";
  - advice may lag but must be bounded: "post-sync the advice is expected to be up-to-date
    considering state the sync transferred (same for instrument readings, etc)". This became
    read-your-writes for each runner, and one alarm cycle for fleet-wide views.

  These are recorded in the resident context (`product.mdx`, values 12, `architecture.mdx`).
  The spec then carried them out:
  - `human-operator` is a runner's statement that grants admit, and rule 6 is retired;
  - R-BTN-45 says gates protect the lock;
  - the freshness bound became evaluation in the write's transaction, plus the reader's read
    after a program change, and an **alarm cycle** is defined.

  A review on Fable 5.1 (round 6) showed most of round 5 dissolving under the advisory model, and
  the owner settled the one design change it proposed: **derived types move from course files
  into `ontology.json`** ("move it as recommended"). The rewrite also:
  - evaluates derived sets with the write that changes them;
  - deletes §11.1's refusal of a heartbeat declaring an ungranted capability;
  - deletes `ontology_proofs`, computing why-not on read;
  - drops R-BTN-126's proof and choice checks;
  - lets advice carry a ranked list the leg falls through;
  - bounds the fixed predicates at acceptance, which was round 5's blocker;
  - caps `choices` per leg, gives `BATON_ROUTE` limits, and moves the refinement check to the
    CLI.

  Round 7 (Fable 5.1) found the seams of §6.11 and one blocker, which led to four owner
  decisions:
  - route choices are attached by the repository's own course entries, so a sourced standard
    course runs unchanged;
  - the advice concept is renamed "route choice", apart from R-BTN-166's choice stations;
  - the 5-minute window is dropped;
  - derived atoms are no longer checked against courses' `values`.

  The rewrite also:
  - makes sets current by an input digest, so a grant change evaluates nothing itself;
  - stores a crossed evaluation as `limited`;
  - fences seats through a pending reap;
  - lets `prefer` candidates carry their own bills;
  - makes `host` and `service` instances usable and billable.

- **2026-10-22 — §6.11: seats (owner direction; B-106).** The owner asked how a leg can say it
  needs "a singleton within the runner's VM", such as a Chrome MCP session one agent can use at
  a time, or a machine reachable over RDP by "a single client at a time". The owner: "specific
  capabilities used by the leg about to be completed should travel with the claim request: the
  runner in the vm is authoritative about this… if they make the claim first, the later claim
  can fail". Baton had the vocabulary, but billing was only a count: S-BTN-21 accepted a claim
  past `max_concurrent`.

  R-BTN-178 makes a bill a seat:
  - capacity per resource, which an `account` instance may override;
  - a `host` scope, so every runner on a VM names the same instance with no administrator step;
  - rule 11 (`instance-busy`), which is never a failed attempt;
  - seats held per leg rather than per claim. This was argued in discussion: a claim may run
    several legs and only one may need the device;
  - release at every end and reap;
  - recommendations that skip full instances.

  S-BTN-21 was rewritten and G-BTN-162 added. The 2026-10-14/16 rejection of reservations now
  names future capacity: a seat a running leg holds is a fact the runner states, not a forecast.

- **2026-10-29 — the standard courses serve the simpler end (owner direction).** The owner:
  "baton is a general tool designed to scale from single-user naive setups where security is an
  afterthought and automation and lock management is the primary concern to something like our
  software factory which has a specific threat model and real security guarantees which heavily
  influence its architecture and the courses it uses. We should put all the immediately run
  security and quality assurance work into fieldhouse and fieldhouse specific baton courses while
  baton should ship courses that don't rely on fieldhouse's specific architecture, and thus are
  simpler / aimed at less sophisticated users." R-BTN-131 gained the scope; §12.8's "the standard
  courses … under `protected` follow (a)" became the runner's harness mode (B-141), with the
  courses the deployment's (Fieldhouse FLDH-41); `docs/context/product.mdx` gained *From one
  machine to a factory*. §12.8's mechanisms stay in core; only the courses that use them move. The
  owner, on that reading: "this is perfect, your interpretation is correct."

- **2026-10-27 to 2026-10-28 — §12.8: the core guarantee (owner direction; B-124, B-127, B-130,
  B-136, B-137, B-139, B-140).** The owner kept push access to a home as the perimeter of a
  fleet, but asked for an explicit security model (`docs/security-model.mdx`) and an adversarial
  review of it, which found 21 problems, five critical: a push to `baton` deploys the server;
  docs held a repository secret with Administration write; every owner gate was passable by the
  owner's agent sessions; any runner key could post the board, so client-side checks were the
  attacker's; the CLI ran from a pushed checkout. Then it was found that `baton repo init` copies a
  sourced course's leg scripts into the home and runners run those copies, so the source pin bound
  nothing (B-139). The owner rejected verifying signatures on pushes that had already landed
  ("counterintuitive to how most software engineers reason about code") and a git proxy (an
  operational burden for getting started with Fieldhouse), and asked for "a protected main
  branch … a dedicated runner type, which runs only deterministic code … taking the merge approval
  logic out of GitHub and placing it into Baton", customisable per course. On courses: "As an
  initial step and before human in the loop support is built out, I think it makes sense to
  require these changes to be done outside of Baton." On tickets: "I would like to be able to
  create tickets in Baton the same way code can be created, but in this case a human approval is
  necessary." On surfaces: "I want the invoker's credentials (runner, repo owner, baton admin) to
  make the difference in which operations are available, not the channel." Rules introduced:
  R-BTN-180–R-BTN-187. The §12 summary gained three bullets; §12.1 the trusted runner and the
  owner's agent; §6.1 the attestation prerequisite; §13 the `attestations` table; §14 its route. The owner
  noted that "approvals come from Baton's records" means "baton must track a new type of state,
  which is human approval"; reading it, R-BTN-116's person leg, answered in git by "whoever can
  push", would have let a runner write its own human approval, so approvals became Baton records (now R-BTN-181's attestations): both kinds of
  approval Baton records bound to one commit, the human's signed by a human-only key. The owner then
  generalised it: "I don't think merge is the only scenario where this trust issue comes up …
  A binary go, no go on merges is not going to be enough … We could use this same type registry
  to record custom trusted state … And these bits of state may be used as a gate for sensitive
  course legs", with trusted services and Baton itself as writers, "attestation" as the name, and
  "Attestation can be modeled as a type of prerequisite for a leg." R-BTN-181 (attestations) and
  R-BTN-182 (trusted runners) replace the approvals rule. A third fresh review found the headline
  still did not hold (R1–R20, below); the owner then agreed to commits signed by runners' Baton
  keys, independence by trust domain, two forge identities, and stating plainly that a change
  persuading both reviewers' models lands, with two reviewers from different model families. A
  fourth review found the guarantee still failed (F1–F17): a writer's code ran in its reviewers'
  domains. The owner: signed authorship "might be a very strong addition for Fieldhouse, but I
  don't think this should be universally required for all users of the baton", so it became the
  opt-in `authorship: signed`, and §12.8 states each mode's guarantee separately; and, of "a domain
  that runs a branch's code is a writer, with reviewers never executing branch code and Baton keys
  moved to a host-side signer": "Yes, this makes sense to me." Values 12 and the architecture page
  gained the opt-in exception; R-BTN-35, -161, -165, -171 and -173 their notes. Then, on R-BTN-185: "I'm not
  sure the baton spec should require hardware keys, this sounds more like a fieldhouse
  hardening"; hardware backing became the deployment policy `human_key: hardware`, which
  Fieldhouse's R-FH-3 requires. Then: "a
  runner branch working on a specific ticket should be able to update its own ticket … to
  document the ticket's progression. And the ticket file is the right place to do this. It is
  easy to check that a runner authored branch is only modifying its own ticket file at merge
  time." R-BTN-184 allows append-only progress after the own ticket's `## Status` heading; the
  brief and frontmatter stay human-approved, since a brief reads as the owner's instruction.

- **2026-10-30 — §7.8, R-BTN-115, R-BTN-181: one outbox, and attestations that cover readings
  (owner direction).** The owner, to make Baton easier to onboard: "I think the outbox and the
  courier messages are essentially the same thing. And in the opposite direction, human
  attestation and instrument readings can also be generalized into a single thing, which differs
  only by the participant signing the attestation."
  - **One outbox.** The outbox (R-BTN-171) and `forge-check` notices (R-BTN-115) were the same
    mechanism twice: an effect Baton holds no credential for, claimed under a lease, applied once
    by its id, confirmed by reading it back, and late after a window. R-BTN-171 now holds every
    such effect as an outbox entry with a `kind` (`handler`, `withdraw`, `answer`,
    `forge-check`), whose order, confirmation and late window are columns of the kind; every
    entry is signed as notices were. Couriers, keys of their own registered with `--delivers git`
    or `forge-check`, deliver it through `/v1/courier/entries`. Retired with it: the built-in leg
    `baton.write`, `runner start --outbox`, the claim response's `outbox` list and the end's
    `written`, the `notices` table, `/v1/courier/notices/*` and `baton.forge-check-late` (now
    `baton.outbox-late` with `kind: forge-check`). States are `queued`, `claimed`, `delivered`,
    `skipped`, `confirmed` and `dropped` for every kind (`written` and `landed` before, `sent` for
    notices). A forge-refused push now holds the ticket `outbox-refused` instead of ending a
    runner's claim. `baton.cancel` no longer drains the `withdraw` entry: Baton queues it when
    the cancel ends. `runner:baton-legs` is declared by every runner that implements
    `baton.cancel`.
  - **Readings are attestations.** Asked whether a gate on a reading should be the course's to
    decide, the owner: "Why not leave this up to the course to decide what the gate should be for
    the leg? It could actually depend on a reading if we want (eg: account funds)." An attestation
    (R-BTN-181) is now about work or about a resource instance; a reading is the second (R-BTN-76).
    A requirement chooses `binds: gate | advice` and `missing: block | allow`, so a `resource`
    block gates where its requirement says so (R-BTN-75); `where` gained `gte` and `lte` and the
    block `failed-where`. Rule 1 refuses a `resource` or `attestation` row that binds as a gate,
    `ticket_blocks` gained `binds`, and `attestation` joined R-BTN-75's list of block kinds, from
    which it had been missing. Readings may be unsigned, and an unsigned one never counts toward a
    trusted leg.
  - **Writers in the course.** Told that writer classes had to stay out of git because a pushed
    course could accept a runner's own statement, the owner: "no because of branch protection, the
    changes would live on a branch that is never merged into main". Under `protected` a course
    file is a control path that lands only by a human (R-BTN-184); under `cooperative` gates bind
    cooperating runners only (R-BTN-46). So a requirement's `writers` is in the course file, and
    the `attestation_policies` owner setting is retired; the trusted runner still pins the keys
    it acts on (R-BTN-182).
  - **Who delivers is a policy.** The first draft fixed that runner keys never deliver and that
    a `git` courier runs as a trusted runner under `protected`. The owner: "I agree with the
    security content, but I want these decisions to be an explicit policy, stored by baton per
    repo which the repo owner can modify. The protected / cooperative dichotomy is too
    simplistic." R-BTN-171 gained the owner setting `outbox_policy`, with one entry per delivery
    class (`git`, `forge-check`). Each entry names its `deliverers` (`courier`, `runner`,
    `trusted-runner`), its `trust` (`any` or `trusted`) and a `min_release`. The default admits
    dedicated couriers only. Loosening the policy is a loosening change (R-BTN-186). R-BTN-180's
    guarantee for Baton's git writes now holds only while the `git` policy is at least
    `courier`/`trusted-runner`, `trust: trusted` and a templating `min_release`; anything looser
    is the repository's stated exception.
  - **Policy, not modes (R-BTN-188, R-BTN-189).** The owner, on that setting: "Outbox-policy is
    the wrong level of abstraction. We need a repo-level policy not just for the outbox, but also
    for all the other protected vs cooperative mode differences. These modes shouldn't be
    hardcoded into baton … Baton cannot assume all customization fits into predefined modes", and:
    "Fieldhouse and baton's most important interface is the baton policy enforcing fieldhouse's
    security guarantees." Then, deciding the open points:
    - deployment duties Baton cannot observe ("reviewers run no branch code", "reset a VM after
      it ran branch code") "don't have a place in baton per repo policy, therefore must live
      somewhere else";
    - `owner` and `human` are the only approver levels;
    - one versioned document with an append-only change log, trusted runners pinning the hash of
      the sections they enforce;
    - folded into this PR, with an adversarial review once drafted;
    - guarantee names beyond core Baton are defined in the Fieldhouse repository;
    - Baton enforces consumer floors.

    The result: R-BTN-188 holds every rule about authority and trust as a knob of one versioned
    policy document per repository, each knob with an order from strict to loose. The knobs cover
    approvers, the minimum `human_key`, grant defaults, the writers admitted to each ref class,
    protected and control paths, ticket approval, merge criteria, authorship, created tickets,
    outbox delivery, board posts, answers, and whose attestations and readings count.
    `cooperative`, `protected` and `protected-signed` are presets; no rule reads one. R-BTN-189
    defines nine core guarantees as conditions over the policy, floors that refuse any change
    breaking a guarantee they name, and a signed read, `--require` on runners and section pins on
    trusted runners. R-BTN-180 keeps trust levels and forge protection, read from the policy.
    R-BTN-183's merge criteria become `merge.*`. R-BTN-185's human gate becomes any action whose
    approver is `human`. Retired settings: `landing`, `authorship`, `protected_paths`,
    `machine_sync` and the draft's `outbox_policy`. Whose attestations count moved from the course
    file back into Baton (the policy's `attestations` and `readings`), since `paths.control` can
    now leave course files agent-writable. B-145 builds it.
  - **The first adversarial review of the policy** (two fresh reviewers, a security attack and a
    consistency pass) found that the draft's `protected` preset guaranteed less than the old mode.
    Fixed in the same PR:
    - **Looser.** A change that swaps one member for another was neither looser nor tighter, so
      it slipped through. Looser is now "admits anything the old value did not"; removing a
      protected pattern, and any incomparable value, are loosenings.
    - **Guarantees include what they rest on.** `tickets-approved`, `control-paths-human`,
      `independent-review` and `signed-authorship` now include `no-runner-lands`.
      `tickets-approved` and `independent-review` pin their types' writers. `no-runner-lands`
      covers `refs.other` and `merge.trusted`. Every guarantee is stated to hold against an
      injected owner's agent only together with `human-gates`.
    - **Deliverers.** `no-runner-lands` contradicted courier delivery to the default branch, so
      under it only trusted runners deliver git kinds. Couriers gained a trust level and trust
      domain. `min_release` is declared honesty, not a control.
    - **Tightening `approvers.trust`** now leaves cleared grants `untrusted`, not at the default.
      Only an owner key may do it, and null trust domains never count as distinct.
    - **Lock-outs.** A `human` approver, `human_key: hardware` or a `remove_by: human` floor now
      needs an owner's `human_only` key. Administrators meet a repository's `human` approvers
      with a `human_only` key, replacing the instance-wide rule.
    - **Signed reads** carry the repository, the tenant and a 10-minute `valid_until`, under the
      `baton-policy@1` signing namespace. Runners refetch on `guarantees_hash` too, so forge
      drift is seen.
    - **Protection reports.** Only trusted runners' reports feed `no-runner-lands`.
    - **Pins.** Trusted runners pin the whole policy and its floors.
    - **Readings** count per repository, through its `readings` entry. A gate under
      `signed: true` counts only signed readings, which the reading routes now carry.
    - **Re-checks.** Writer rules are checked again at every course snapshot, and a trusted leg
      may not take `missing: allow`.
    - **Export.** Policy versions and floors are exported, and an import never falls back to a
      preset.
    - **Declarations.** `released:policy` is declared, the presets got full value columns, and
      `tickets.created: proposed` now covers every outbox git kind.
    - **Stale references** in §13.6, S-BTN-123, the security-model page, the vocabulary, B-67,
      B-140 and B-145 are fixed.
  - **The second adversarial review** found that most round-one fixes held, the definition of
    "looser" and the lock-out check among them, but four holes remained. Fixed in the same PR:
    - **Control paths.** `no-runner-lands` did not constrain `paths.control`, so a runner's
      workflow change landed under the trusted runner's credentials. It now requires control
      paths a runner cannot land, proposed tickets, and `board-from-trusted` includes it.
    - **Repository code in delivery.** The trusted runner delivered through the repository's
      `.baton/tickets.mjs`. It now writes only from the CLI's templates and refuses an ejected
      source.
    - **Proposals that could never land.** Proposed tickets had no way to merge. A proposal now
      lands by a proposal merge, with one `std:approval@1` and no reviews.
    - **The protection credential.** The credential that reads GitHub's `bypass_actors` can
      rewrite the rulesets. It now belongs to a separate protection checker, never a workflow
      and never the merge runner.
    - **Smaller fixes:**
      - `refs/baton/*`, which GitHub rulesets cannot restrict, is outside every guarantee.
      - Runners pin the tenant signing key and check the tenant, and the read carries
        `floors_hash`.
      - Floors are judged on policy conditions alone, so a lapsed report never deadlocks a
        change, and the checker keeps checking while others stop.
      - A delegated key changes no policy, and an owner may restore the version its own
        tightening replaced within 24 hours.
      - Absent `attestations` and `readings` entries admit nothing, `readings` gains a `*`
        entry, and instruments leave `approvers.members`.
      - The first human-only key comes from `BATON_HUMAN_KEYS`, later ones from
        `/v1/human-keys`, and the last key a `human` approver needs cannot be revoked.
      - `trust_set_by`; unmarked grants are `untrusted` while `approvers.trust` is `human`;
        tightening onto a violation is refused.
      - Baton refuses a policy whose writes could never land.
    - S-BTN-191 and G-BTN-165 test the new rules.
  - **Two owner corrections, 2026-10-31.**
    - **No runner-side enforcement.** The owner: "untrusted runners execute within the sandpit
      virtual machine along with generated code, and as a result cannot be trusted to maintain
      the guarantees they promise to." `--require` is gone. While a floored guarantee is broken,
      Baton itself refuses every claim and advance on the repository (rule `policy`,
      `policy-broken`) and releases running claims (`released:policy`). The signed read serves
      trusted runners and audits only.
    - **One approver for every change.** The owner: "it seems simpler just to specify who may
      change the policy without making any distinction between whether the new values tighten or
      loosen the given setting." Gone: the strict-to-loose order, the definition of "looser",
      `approvers.loosen` (now `approvers.policy`, governing every change to the policy and its
      floors) and the owner's 24-hour restore. A delegated key is never an approver. Floors still
      refuse any change that breaks a guarantee they name.
    - **Approver lists.** The owner: "How about the list of approvers who may update policy is
      itself a policy configuration item?" Each `approvers.*` knob is now a list of `owner`,
      `human` and `key:<fingerprint>` entries. A change to a list is authorised by
      `approvers.policy` as it stands before the change. Baton refuses a list no live credential
      can satisfy, and refuses a revocation that would leave one. `human-gates` holds when every
      list is human-only. S-BTN-192 tests it.
  - **The third adversarial review** found that rounds one and two held. What remained were small,
    local defects. Fixed in the same PR:
    - **Approvers scoped to the repository.** `human` and `key:` match only owners of the
      repository, so a human-only key minted elsewhere carries no authority there.
      `/v1/human-keys` no longer makes owners. Owner removal and administrator revocation are
      refused when they would leave a list unsatisfiable (`unsatisfiable-approvers`).
      `BATON_HUMAN_KEYS` is the stated break-glass.
    - **The floor stop reaches every repository.** It covers every repository a ticket reaches,
      not only its home, and code-repository consents became an `approvers.members` action.
    - **Floor removal** needs a credential satisfying both `remove_by` and `approvers.policy`.
    - **Declarations completed.** The §14 rows carry every field the signed read binds. Each
      guarantee states its promise.
    - **Readings.** The `readings` row is repaired, and the `protected` preset no longer drops
      runner readings everywhere.
    - **Renames.** The new rule and release reason are now `floor` (`floor-broken`,
      `released:floor`), apart from rule 8's `policy`.
    - **Single approver for trust.** Trust attributes leave R-BTN-186's list for
      `approvers.trust`.
    - **Wording.** An outbox `failed` mark is declared as a mark, not a state. Stale wording is
      fixed in S-BTN-136, S-BTN-191, G-BTN-156, R-BTN-185, the decisions, the security-model page,
      B-64 and B-145.

- **2026-10-31 — R-BTN-190: leg state on a per-ticket side branch (owner direction).** Plain git
  repositories with no forge carry leg-to-leg state, such as review findings, as files. B-101 put
  them on the PR branch, deleted before the squash. The owner asked for a directory convention so a
  check could verify the deletion. The first draft reserved `.baton-legs/` on the work branch,
  outside the `.baton/` control directory, and had the merge runner strip it ("Strip as you
  recommended. `.baton-legs/` is fine").

  Two adversarial review rounds found that review commits after the review move the attested
  head. The draft's fix let attestations bind the tree without `.baton-legs`, and that rested on a
  leg's own claim that a commit was leg state only, which nothing trusted could check. Every repair
  needed a trusted verifier of each such commit, plus a protected landing ref for human merges.

  The owner then chose a side branch: "per-ticket side branch is fine". R-BTN-190 now says:
  - leg state lives on the ticket's work branch name plus `--legs`, inside `branch_pattern`,
    and nothing merges that branch;
  - its layout is `.baton-legs/<ticket>/<leg>/<claim nonce>/…`, with plain files and no names of
    harness configuration;
  - it is never checked out, and is read through `git cat-file` as quoted data;
  - counted reviews read none of it;
  - a work branch carrying an entry that folds to `.baton-legs` is refused at merge;
  - the branch is deleted when the ticket closes;
  - detection on the default branch is closed only by the protection checker's reading where one
    exists.

  The work-tree, leg-state-commit, strip and landing-ref text of the first draft never merged.

  The owner then narrowed it: "this is very unidiomatic for forges so we should only do this for
  plain git (make it a policy setting)". The new knob `leg_state` takes `forge` (the PR
  conversation, R-BTN-131) or `branch` (the side branch). Unset, it means `forge` on GitHub,
  GitLab and Gitea and `branch` where `forge` is `git`. `forge` is refused on a `git` repository.
  The work-branch refusal and the detection hold under either value.

  The owner then asked for a template: "There should be a plain git policy template." The
  `plain-git` preset is the `cooperative` column without what a repository with no forge cannot
  use: `leg_state: branch`, `inputs.board` without `ci-identity`, and no `forge-check`
  deliverers. It is a new `git` repository's default. `protected` and `protected-signed` applied to
  a `git` repository write the same three values, and Baton refuses the forge-only values there.

  **The final review round** found the side branch named inside `branch_pattern`. Every reader of
  that pattern would treat it as a work branch, the foreign-commit rule would reset it, and its
  name could collide with another ticket's branch. It also found that the layout regex rejected
  its own required path. Fixed in the same PR:
  - **A reserved namespace.** The branch moved to `baton-legs/<ticket id>`, an orphan history no
    `branch_pattern` may match, governed by a new `refs.legs` class.
  - **Not a write.** A push to it reports no range, triggers no foreign-commit reset, and makes no
    writer.
  - **The grammar** applies below `.baton-legs/<ticket id>/` only.
  - **Readers.** Adjudication joins the counted reviews in reading none of it.
  - **The runner's and the deployment's parts** are stated separately.
  - **Verdicts.** The `branch` course writes no verdict commits under `inputs.answers:
    attestation`.
  - **Folding** covers any segment at any depth.
  - **Detection's detail** lists only existing ticket ids.
  - **Declared fields:** `leg_state` on the claim response, `legs` in the checker's report, and
    `legs_landed` on the board post.

## Retired requirements

| Id | Title | Retired by | What replaced it |
|---|---|---|---|
| R-BTN-41 | the review queue is bounded | this rewrite (2026-10-20) | `roadmap-pr`'s ranking code, in docs' `BATON_ROADMAP_PR_COURSE`; core counts `max_queue` (R-BTN-79) |
| R-BTN-52 | hooks narrow and order; they never grant | R-BTN-98 (2026-10-16) | workers rank (`rank.mjs`); recommendations are gates plus the default order |
| R-BTN-54 | the trust model, stated | R-BTN-98, R-BTN-102 (2026-10-16) | Baton runs no repository code; the machine key's trust (R-BTN-102); R-BTN-66 |
| R-BTN-59 | local hooks: the same interface, trusted code | R-BTN-98 (2026-10-16) | nothing: the local host runs no hooks |
| R-BTN-80 | notices: Baton queues requests for people; couriers deliver them | R-BTN-164 (2026-10-20) | conditions and handler courses (R-BTN-160–R-BTN-163, R-BTN-169); the forge-check notice lifecycle moved into R-BTN-114 and R-BTN-115 |
| R-BTN-103 | worker couriers deliver from a pool | R-BTN-164 (2026-10-20) | a courier is a runner with a capability, running a handler course (R-BTN-161) |
| R-BTN-118 | a running leg's output streams to its viewers and is never stored | R-BTN-128 (2026-10-21) | `baton leg log -f` follows the run's chunks in the owners' log location; the dashboard shows no live output |
| R-BTN-164 | Baton queues no notices for people | this rewrite (2026-10-20) | one line in §7's introduction; `baton decision list` in R-BTN-163 |
| R-BTN-170 | the window | this rewrite (2026-10-20) | **Migrations the implementation still carries**, below |

R-BTN-23 (retry policy) is not retired: it is merged into R-BTN-122, whose heading carries both
ids. R-BTN-21, R-BTN-27, R-BTN-42, R-BTN-43 and R-BTN-49 are the `roadmap-pr` course's own rules,
defined in docs' `BATON_ROADMAP_PR_COURSE` (check-spec's `COURSE_IDS`).

## Retired scenarios and gates

| Id | What it tested | Retired by | Note |
|---|---|---|---|
| S-BTN-29 | hooks and probes | R-BTN-98 (2026-10-16) | G-BTN-84 covers no repository code in Baton |
| S-BTN-35 | a claim during a hook call | R-BTN-98 (2026-10-16) | the one-transaction claim stays (G-BTN-1, G-BTN-2) |
| S-BTN-46 | a decision reaches its owner through personal couriers | R-BTN-164 (2026-10-20) | `test/integration/S-BTN-46.decision-reaches-owner.test.ts` tests retired behaviour; S-BTN-131 replaces it |
| S-BTN-60 | worker couriers and the pool | R-BTN-164 (2026-10-20) | `test/integration/S-BTN-60.worker-couriers.test.ts` tests retired behaviour |
| S-BTN-70 | watching a leg over Baton's relay | R-BTN-128 (2026-10-21) | S-BTN-99 covers following a running leg from the log location |
| S-BTN-90 | decision severities routed to couriers, reminders | R-BTN-164 (2026-10-20) | ordering by severity survives in S-BTN-131 |
| S-BTN-135 | the window | this rewrite | migration (R-BTN-170) |
| G-BTN-54 | hook sandboxing | R-BTN-98 (2026-10-16) | G-BTN-84 |
| G-BTN-60 | gates re-checked after a hook call | R-BTN-98 (2026-10-16) | one transaction per claim |
| G-BTN-72 | one notice per courier per open decision, reminders, pool copies | R-BTN-164 (2026-10-20) | G-BTN-154 |
| G-BTN-95 | leg output relayed only from the holder to authorized same-origin viewers | R-BTN-128 (2026-10-21) | G-BTN-118, G-BTN-119 |
| G-BTN-110 | notices carry severity; per-severity routing | R-BTN-164 (2026-10-20) | — |
| G-BTN-28–30, -34, -45, -46, -48, -52, -65 | the `roadmap-pr` course's own logic | moved 2026-10-14 | docs' `BATON_ROADMAP_PR_COURSE` §7 |

Parts retired from surviving rows: S-BTN-105 and G-BTN-124 keep only the override half (the rest
became S-BTN-110 and G-BTN-129, 2026-10-19); S-BTN-95 and G-BTN-115 lost the legacy
`provider-exhausted` mapping; S-BTN-97 and G-BTN-117 the twelve old command names; S-BTN-108 the
second repository's window case; S-BTN-110 the B-33-form move; S-BTN-134 and G-BTN-152 the
phase-1 translation; G-BTN-154 "after phase 4"; S-BTN-132 the empty call's `baton.call-empty`;
S-BTN-49, G-BTN-76 and G-BTN-127 the `children` selector and the parent's provisional `spawned`
block; G-BTN-87 delivery as a worker courier; G-BTN-120 S-BTN-60's half. The second G-BTN-145 (API
keys, R-BTN-159) is G-BTN-155. The schema review (2026-10-20) retired S-BTN-64's and S-BTN-123's
`isolation` refusal (now rule 4's `missing-capability`), S-BTN-68's course-file `checks` proposal,
G-BTN-127's `run` selector and G-BTN-152's "timing" qualifier (every retired course field is
refused).

## Old § → new §

| Old | New |
|---|---|
| header, status line, Reads first | spec header; history (this file) |
| 1. Why this exists | §1 |
| 2. What lives where | §1; §4.1 |
| 2a. Repositories and courses | §3.1, §5.1; names and etymology: history |
| 2b. The boundary | §1 (R-BTN-50); its "what moves" table: history |
| 2c. Hooks, probes and the trust they imply | retired (hooks); probes §6.3; trust §1 (R-BTN-66), §12 |
| 2d. Courses change without Baton | §5.7; §1 (R-BTN-66) |
| 2e. Stations and legs: the course file | §5.2, §5.3 |
| 2f. Ticket sources and the CLI's defaults | §4.1, §4.2 |
| 2g. Blocks | §6.1–§6.4; queues §5.4; notices §10 (forge-check only) |
| 2h. Positions, history, replay | §5.3, §5.5, §4.7, §9.8 |
| 2i. Child tickets, the capacity envelope, export | §4.6, §2.3, §4.8 |
| 2j. Time on legs | §6.5, §7.5; the doorbell §8.1 |
| 2k. Forges, sync keys and pulled syncs | §3 |
| 2l. Baton serves state; workers decide | §1 (R-BTN-98), §6.6, §6.7, §8.2, §4.5, §3.3; worker couriers retired |
| 2m (intro), 2m.1 The runner as organizer | §8.3 |
| 2m.2 Typed outputs | §5.5 |
| 2m.3 Session links, checks and couriers | §8.5 (session links), §10 |
| 2m.4 Registering without a user's key | §8.2, §11.1 |
| 2m.5 Watching and stopping a running leg | §8.5 |
| 2m.6 A leg's prerequisites | §6.1; capability types §5.6 |
| 2m.6a Retries per leg | §7.4 |
| 2m.6b Fresh context, a planning course, urgent decisions | §8.4 (R-BTN-123), §5.8 (`epic`), §7 (severity, R-BTN-125) |
| 2m.6c A prerequisite can fail during a leg | §6.2 |
| 2m.6d The CLI as a command tree, and a leg's log | §11.3, §8.5 |
| 2m.6e One registry of actions | §11.3 |
| 2m.7a The wire, the settings and the interfaces | §14, §13, §2.1 |
| 2m.7 What core gains | §13, §14 |
| 2m.8 Scenarios and gates | §15 |
| 2n. One primitive per kind of prerequisite | §6.1; its window: history |
| 2o. A leg runs in a checkout of its commit | §8.4 |
| 2p. A course is what its source names | §5.1 |
| 2q. Conditions … compensation | §7 |
| 2q.1 Scenarios and gates | §15 |
| 3. The service | §2.1 |
| 3a. Hosting | §2.1 |
| 3b. Tenancy | §2.2 |
| 3b.1 Scenarios and gates | §15 |
| 4. Data model | §13 |
| 5. Workers | §8.1 |
| 6.1 The lock, 6.2 Claiming | §9.1 |
| 6.3 Holding, 6.4 The sidecar, per harness | §9.2 |
| 6.5 Ending a claim | §9.4 |
| 6.6 Reaping | §9.5 |
| 6.7 Confirming completions | §9.6 |
| 6.8 Transcripts, 6.9 Activities | §9.9 |
| 6.10 Attempts, retries and the automatic hold | §9.7, §7.4 |
| 6.11 Resuming | §9.8 |
| 6.12 The ticket as a course | §5.3, §9.3 |
| 6.13 The runner | §8.3 |
| 7.1 Board sync | §4.3, §4.4 |
| 7.2 Matching | §6.6 |
| 7.3 The `roadmap-pr` course's provider logic | docs' `BATON_ROADMAP_PR_COURSE` |
| 8. Ticket overrides: expedite and hold | §6.8 |
| 9. Messages | §6.9 |
| 10.1 Principals | §12.1 |
| 10.2 Worker secrets | §8.1, §12 |
| 10.3 The sync principal | §3.2 |
| 10.4 Untrusted text | §12.3 |
| 10.5 Same-site with the product | §12.4 |
| 10.6 Administration | §11.1, §11.2 |
| 10.7 Hardening within a tenant | by rule: §3, §4, §5, §6, §8, §10, §11, §12 (R-BTN-139–R-BTN-158) |
| 11. API | §14 |
| 12. The git mirror | §16.3 |
| 13. Rollout | §16.1, §16.2 |
| 13a. Integration tests | §15 |
| 14. The dashboard | §11.4 |
| 15. What this amends | history (Changelog); open items §2.1, §16.2 |
| 16. Load-bearing assumptions; Depends-on-today | Load-bearing assumptions |
| 16. Must-establish | §15 (Gates) |
| Decisions & rejected alternatives | Decisions (one line each); in full below |
| Open questions | Open questions (current ones) |
| Review record | below |

## Migrations the implementation still carries

Each entry is a transition the specification no longer describes. The code keeps the old form
working until the stated condition holds, then removes it.

- **R-BTN-132's window (prerequisite primitives).** The board post's `blocked_by` and
  `operator_only`, and the `waiting_on` labels `dependencies`, `children` and `owner`, are still
  read: `blocked_by` as whole-ticket `ticket` blocks, `operator_only` as `human-operator` in
  rule 4, the labels as before, each logging one `deprecated-field` event per repository and
  field per day; a repository still posting them is listed for its owners. The default source,
  docs' `tickets.mjs` and the standard courses write only the new forms (`depends_at`,
  `requires.tickets`, person legs). Stop when no registered repository's snapshot carries an old
  form: the board-post validator then refuses them, and a migration stops storing
  `tickets.depends_on`, `tickets.blocked_by` and `tickets.operator_only`. `S-BTN-107` and
  `S-BTN-104`'s tests still assert `waiting_on: owner|children`; they change when `build-app` and
  `decision` move to person and call legs.
- **R-BTN-170's window (conditions).** Phase 1: the course validator reads `error_types` as
  `interrupt` conditions (`retryable` kept), `max_duration` as an interrupting `start` timer
  (with R-BTN-90's `leg_finished` re-arm to 40 minutes), `max_attempts_s` as an interrupting
  `first_attempt` timer holding `budget-spent`, and `max_ready_s` as a non-interrupting `ready`
  timer raising `baton.ready-late`, logging `deprecated-field`; notices for registered personal
  channels and worker couriers keep being queued beside the conditions. Phase 2: the standard
  courses move as new versions replaying their in-flight tickets (R-BTN-48) — `create-pr` and the
  others gain `error.no-answer`, `epic` moves onto calls. Phase 3: repositories still on an old
  form are listed. Phase 4, last: notices for people stop, courier keys registered with `--asks`
  are revoked (a key with no other registration is deleted), the heartbeat's `couriers` is
  refused, and the validator refuses the four old fields. Stop at phase 4.
- **The `ROLES` window (R-BTN-121).** A course file that declares no `capability_types` is read
  with its untyped capability names expanded through the vendored `ROLES` in `vocabulary.mjs`,
  and a grant's type-less legacy capability (`agent-venue`) satisfies it. A course leaves the
  window when an accepted snapshot first carries its file with types. Stop when no registered
  course reads through `ROLES` (the **Courses** view shows it): remove `ROLES`.
- **Legacy schema forms (R-BTN-108).** A contract output whose `schema` is a file path is read
  as `<course>:<leg>.<output>@<contract version>` with no base. Stop when no registered course
  file uses a path.
- **Bearer-key migration (R-BTN-117).** The bearer tokens and `BATON_KEYS` seed keys the code
  accepted become API-key credentials, granted on each repository they heartbeated or claimed on
  in the 30 days before, with the capabilities they declared there and `accepted_at` set to the
  migration's time (B-8); a seed key so granted on two or more repositories lands at span 2 with
  sync off; each grant is raised for its owners to confirm or revoke. Stop accepting bearer
  tokens and `BATON_KEYS` once the migration has run.
- **Renamed CLI commands (R-BTN-127).** The twelve old top-level names (`baton why`, `run`,
  `test-course`, `init`, `sync`, `mirror`, `spool`, `inbox`, `blocked`, `replay`, `register`,
  `start`) exit 2 printing only a "renamed:" line naming the replacement. Remove them once no
  caller uses them (B-23 updated the known callers).
- **`provider-exhausted` (R-BTN-126).** Until every course's `min_worker_version` is past the CLI
  version that ships R-BTN-126, Baton accepts `released:provider-exhausted` and records it as a
  `blocked` end: with exactly one account instance in the worker's `uses` serving a resource in
  the leg's `leg_needs`, a `resource` prerequisite naming that need plus, unless the worker has
  an unavailable reading of it in force (never shortened), a one-hour `available: false` reading;
  with none or several, no reading, counted toward `max_blocked` unless the worker's own
  unavailable reading of a serving instance is in force. Every such end counts toward the
  worker's blocked-ends threshold.
- **B-33's source form and the `pr` course (R-BTN-131, R-BTN-134).** A repository with a home
  copy of a course file naming `github/<owner>/<name>/<commit>/<course>` is refused naming
  `baton repo init`, which moves it in one commit, keeping its instructions and override.
  `--course pr` is refused naming `create-pr`, and init moves a `pr` repository onto
  `create-pr`. Stop when no registered repository is on either form.
- **Forge ids for older rows (R-BTN-138, R-BTN-92).** A repository registered before forge ids
  were required verifies by path and is raised until `repo identify` stores its ids
  (`forge_ids_seen`, `conflict` naming the ids seen, `confirm`); the backfill of `forge`,
  `web_base` and `remote` for existing rows. Stop when every registered forge repository has its
  ids.
- **The `conditions` source to the outbox (R-BTN-163 → R-BTN-171).** R-BTN-163 as amended on
  2026-10-20 had a fourth CLI ticket source post a fileless handler ticket
  `baton.<sub>.<condition_id>` for each open bound core condition, and choice settlements were
  read by syncs from `GET /v1/sync/choices`. If either was built, keep accepting such posts —
  superseding each ticket when its condition closes — and keep answering the route, until every
  runner on the repository declares `runner:baton-legs` and the CLI version that drops them is
  every sync's.
- **Notices for people to conditions (R-BTN-80, R-BTN-103, R-BTN-164).** Until R-BTN-170's phase
  4 the code keeps the `decision` and `queue-over` notice kinds (a `queue-over` notice per `owner`
  courier, payload `{course, leg, depth, max_queue, intake}`, with `queue-over`, `course-closed`
  and `course-opened` events — R3-1255), personal channels (couriers with
  `asks` and severities, `remind_after`), worker couriers (heartbeat `couriers`,
  `refused_couriers`, the `pool` credential, `worker_couriers`, the grant's and token's
  `courier` flag and role), and `GET /v1/courier/decisions`. After it they are dropped; only
  `forge-check` notices remain.
- **Hook residue (R-BTN-98).** The code still carries the `HookRunner` port and cites R-BTN-52 and
  R-BTN-59; `hook-failed` survives only in a CHECK constraint. Remove when next touched.
- **The docs deployment's own migration** of `skills_version` to each course's `version`, with
  the `Skills-Version:` trailer as an alias (R-BTN-22), belongs to docs' `BATON_DOCS_DEPLOYMENT`.
  Cutover itself — shadow reports, the legacy-claim import and adoption — stays in the
  specification (§16.1).
- **"Worker" is "runner" (2026-10-20, owner).** The spec names every process that can execute a
  leg a runner — an interactive runner (an agent harness session, through its sidecar) or a CLI
  runner (`baton runner start`). The code still uses the old names; rename them through a
  dual-read window: the tables `workers`, `worker_grants`, `worker_capabilities`, `worker_tags`,
  `worker_courses`, `worker_instances`, `worker_reports` and the index
  `worker_instances_by_instance` (→ `runners`, `runner_*`); the columns `worker_id`,
  `from_worker_id`, `to_worker_id` and `min_worker_version`; the credential kind `worker`; the
  header `X-Worker-Secret` and the trailer `Min-Worker-Version`; the query `?worker=me`; the
  refusal `worker-reaped`. A runner accepts both header names until every runner sends the new
  one.

- **Course fields the schema review removed (R-BTN-69, 2026-10-20).** Until every registered
  course file has moved, the course validator reads them, logging one `deprecated-field` event
  per repository, course and field per day and listing the course for its owners:
  - a leg's `isolation: "session"` as `runner:session` added to its `requires.capabilities`
    (the code's `graph.ts`/`gates.ts` rule `isolation` and `course.ts`'s check implement the old
    form today);
  - a leg's `call: {course: <id>}` as `spawns.course` when `spawns` names none, and refused when
    they differ; `call: {condition: <type>}`, if built, keeps resolving through the bindings as
    before;
  - `retry.non_retryable` as before: each listed type is not retried on that leg, ending with
    its declared class;
  - a `requires.tickets` entry with `select: "run"`, if built, as before;
  - course-level `checks` is ignored (it never bound).

  `build-app`'s `file` and `verify` move onto call legs as a new course version replaying its
  in-flight tickets (R-BTN-48); S-BTN-107's test still asserts `waiting_on: children` until then.
  Stop when no registered course file carries any of these: the validator then refuses them
  (R-BTN-69, S-BTN-134).

## Resolutions made in the rewrite

Where the amended text contradicted itself, or left a gap the single-version text had to fill, the
rewrite chose as follows (the later amendment won unless noted). Grouped by the new section that
states the result.

### §1, §2, §16

1. **What a tenant holds** (R-BTN-135) listed "notices, decisions". It now lists conditions,
   timers and notices; notices are forge-check only.
2. **`transcript_repos` home.** Old §2a put it in `.baton/baton.json`; R-BTN-66 makes it an
   owner setting in SQLite. SQLite wins.
3. **Grant `courier` flag.** It is dropped from R-BTN-66's settings (plan item 2).
   - `keys.json` keeps a `courier` role, for the forge courier.
   - **W6/W7 (R-BTN-146 and §14):** drop `courier` from `PUT …/grants/{fp}/flags` and from
     `GET …/grants`.
   - `machine_sync` was missing from the old settings table. It is added.
4. **Requests and the hook.** Old §3 said a request awaits at two points. It awaits only at the
   signature check. R-BTN-87's latency budgets drop "plus the hook", and R-BTN-55's
   serialization row releases only at the signature check.
5. **The envelope and the hard caps.** R-BTN-87's "nothing is refused past 100%" stands
   against R-BTN-149's caps at twice the envelope. The text says both: the envelope refuses
   nothing, and the caps do.
6. **The alarm list** is rewritten against §7. It now covers timers, a choice's `after_s`,
   `retry_after`, owner bar start and end, and R-BTN-171's 24-hour outbox check.
   - Notice reminders are gone.
   - `max_duration` deadlines are gone; they are timers now.
7. **R-BTN-149's "Deadlines" bullet** (`leg_finished` re-arm once per seq, `extend_to` at most
   7 days ahead) is left to R-BTN-90 (W5 states both).
8. **"Listed under Needs you"** in my rules became these conditions:
   - `baton.regressed` (R-BTN-35, 30 minutes);
   - `baton.foreign-write` (R-BTN-46);
   - `baton.capacity` (R-BTN-87);
   - `baton.too-large` and `baton.write-budget` (R-BTN-149).

   If anyone keeps a central list of `<sub>` names, add these.
9. **R-BTN-37 (vendoring) is the current state.** R3-1237 is still `available`, and
   CLAUDE.md enforces the manifest check.
   - The vendored set is taken from `src/shared/manifest.json`. It includes `batonSync.mjs`,
     which the old text did not name.
   - The target is one sentence.
10. **R-BTN-32's names.** The old names were `lib/baton.mjs` and docs' `baton-now.mjs`.
    - Clients use `batonNow()`, in `src/shared/baton.mjs`.
    - The core uses `this.now`, and tests set it with `setClock` (CLAUDE.md).
    - The "`pre-push` always asks Baton" second line belongs to fencing. W6 (§9) states it.
11. **Who sets cutover** (R-BTN-28). It is an administrator, through a confirm code
    (R-BTN-155), not "the owner on the dashboard".
12. **Foreign git claims with no Baton claim** are imported as legacy only during the cutover
    step, and reverted after it (§10.7.5's correction).
13. **Mirror dispatch** ("after each claim, release, reap") is now a want (R-BTN-94).
14. **"Baton gets no git or forge credential"** (plan) against R-BTN-55's `ForgeSecrets`
    dispatch credential and the GitHub App's installation tokens.
    - I kept both as dispatch adapters, which trigger workflows and never write git.
    - §1 says Baton writes no git itself (R-BTN-171).
    - **W2 (R-BTN-94) / integrator:** confirm the dispatch adapters stay.
15. **R-BTN-46's "the mirror's revert is the one place Baton writes git over another writer"**
    moved to §16.3. It now says "a writer for Baton", since Baton itself writes no git.
16. **R-BTN-56 and R-BTN-138** both said one Baton per repository is not checked across
    tenants. R-BTN-56 now holds it alone. **W2:** do not restate it in R-BTN-138.

### §3, §4

1. **Forge-path uniqueness.** R-BTN-92 says unique per forge host; the column is `UNIQUE` across
   hosts and R-BTN-138's held rename uses "on any host". Wrote: unique among the tenant's live
   repositories (across hosts). W8: schema should match.
2. **App deliveries' reach.** R-BTN-73 maps a delivery to repositories "whose tickets name the
   repo"; R-BTN-140/156 limit reach to `code_repos`. Wrote: a delivery wants its own repository
   and each registered repository whose `code_repos` lists it, by id.
3. **R-BTN-104 "none is a failed attempt"** vs R-BTN-148's `misdeclared` row: only `misdeclared`
   is a failed attempt.
4. **`declared.cli`.** Review record 2-A-3 says a `declared.cli` other than the last accepted
   post's is `invalid-params`; R-BTN-148's own text says any is accepted at the claim. Rule text
   wins.
5. **R-BTN-62's 10-minute outstanding-number rule** vs R-BTN-150: R-BTN-150's renew (≤ every
   2 min), 5-min idle takeover by another credential, 10-min same credential, 30-min absolute.
6. **R-BTN-86 "Baton closes nothing"** vs R-BTN-168: children with `lifetime: parent` are
   superseded.
7. **R-BTN-85 `spawned-unposted`'s git value "the posted `blocked_by`"**: `blocked_by` is
   retired; the value is the posted children. `choice-lost` added as the one sub git does not win.
8. **R-BTN-88 export sections**: dropped `couriers` and `ticket_decisions (source: baton)`;
   added open `conditions`, `ticket_timers` and outbox entries not `landed` — **assumption**,
   see below. Not exported now also lists sync wants (R-BTN-94).
9. **R-BTN-147** "raises `max_duration`" → "a timer lengthened or removed".
10. **R-BTN-96 / R-BTN-139 / old §10.3**: "repositories its tickets change / `repos:`" →
    `code_repos` (R-BTN-140).
11. **R-BTN-11** "dashboard and witness digest ask the owner" → raises `baton.held-history`.
12. **§11's observation response** lacked `provisional` (§2l's API list adds it) — included.

### §5

1. **Schema location.** R-BTN-108 put course schemas at `.baton/schemas/<course>/`, but R-BTN-134
   makes a course directory self-contained, with no home copies for sourced courses. I put them
   at `schemas/<name>@<n>.json` inside the course directory. This was plainly a slip, since
   §2p never updated R-BTN-108.
2. **Choice settlements and the sync.** R-BTN-70 said "at a choice station the posted queued leg
   is the settlement Baton holds", via `GET /v1/sync/choices`. The plan retires that route. In
   R-BTN-83, all Baton-decided positions are now one "held positions" bullet: an override that
   wins until the station changes, written to git by the queued leg's own run. Its kinds match
   W5's `next_source` values: `route`, `retry`, `choice`, `timer`, `cancel`, `outbox`.
3. **The `exhausted` leg** was held "as a route override" in R-BTN-167. To match §7, I used
   `next_source: retry`.
4. **R-BTN-112's renderer audiences.** "A courier's text/email" is now the CLI, the `forge-check`
   summary, and a handler course's text or mail. There are no couriers for people.
5. **R-BTN-121's "legacy name holds the file".** The legacy-name case is dropped (window). A role
   naming `human-operator` or another role still holds the file.
6. **`epic` (R-BTN-124), as the integrator resolved it.**
   - `plan` (`filed`) and `replan` (`planned`, `max_runs` 2) are both call legs over
     `create-pr`, with the table `built` ← `{"of": "all", "done": true, "next": "integrate"}`,
     then `planned` ← `{"of": "all", "closed": true, "next": "replan"}`.
   - `replan` may file no child and reach `abandoned` as an ordinary outcome, not a settlement.
   - `integrate` (`built` → `integrated`) is an agent leg.
   - It relies on R-BTN-165's new completion `"closed": true`, which §7 adds.
   - The old text put children on "the home's `default_course`"; the call is over `create-pr`,
     as R-BTN-165 says.
   - **W5:** R-BTN-165's `epic` example must match this. **W9:** S-BTN-132's epic part must
     match too.
7. **Standard handler courses.** Following plan item 13 and §7, these are `ask`, `deliver` and
   `announce` (not `notify`). They are listed in R-BTN-131's table, defined in R-BTN-169.
8. **"Needs you" sites** in my rules now raise `baton.<sub>`. Some sub names are mine; **W5 /
   integrator, please add them to §7's table of core conditions if it has one:**
   - `baton.course-refused`: a course file fails validation, including R-BTN-108 schema
     refusals and R-BTN-142 `renamed_from` collisions;
   - `baton.course-held`: a file held for bars (R-BTN-142);
   - `baton.required-bar`: R-BTN-67;
   - `baton.bars-mismatch`: R-BTN-63;
   - `baton.regressed`: the 30-minute regression (old §2e);
   - `baton.input-version`: beside `baton.input-missing` (R-BTN-82).

   I also used the existing names `baton.course-changed`, `baton.queue-over`,
   `baton.output-invalid`, `baton.contract`, `baton.retries` and `baton.call-empty`.

### §6

1. **Resource `detail` schema subset**: R-BTN-76 had its own keyword subset (no `pattern`,
   `$ref`, `format`; ≤4 KB, 5 levels); R-BTN-108 (later) says the shared validator validates
   readings' `detail`. Later wins: the resource schema is "R-BTN-108's subset"; R-BTN-76's list
   dropped. Integrator: confirm R-BTN-108 (§5) states the subset once.
2. **Probe reporting**: R-BTN-76 said `allowed_instances`; R-BTN-101 (later) says any registered
   instance. Later wins; `allowed_instances` not mentioned. "Probe" is called "instrument key";
   routes kept `/v1/probe/readings`, `POST /v1/admin/probes`.
3. **Bills outside `uses`**: R-BTN-100 "dropped and returned in `refused`" vs R-BTN-151 "refused".
   Resolved as dropped and returned in `refused`; the claim proceeds.
4. **`baton:` decision-id reservation** → reserved prefix is `baton.`; a posted decision id
   beginning `baton.` is dropped and logged. `ticket_decisions` has no `source: baton` rows.
5. **Core conditions write no block rows**: `baton.retries`/`baton.contract` sit on a hold and
   `baton.stalled` on a posted wait, so they need no `decision`/`condition` row. Stated in
   R-BTN-75's "Not blocks" bullet.
6. **`select: children` retired** (plan item 7): the `spawned` end's provisional `ticket` rows
   (R-BTN-86/R-BTN-132) have nothing left to attach to, so they are gone; provisional rows come
   only from `blocked` ends (`ticket`, `decision`, `condition`). The `series` course's `retire`
   leg no longer fan-ins over runs; "stopping" is withdraw the pending run, then retire.
   Integrator: check §4 (R-BTN-86) and §15 (S-BTN-49, S-BTN-51, S-BTN-108/G-BTN-127) agree.
7. **`allow_empty`** applied to any empty selection (`run`, or every ticket skipped as withdrawn),
   since `children` is gone.
8. **Unmeetable ticket entries**: old "listed under Needs you" for no-parent/unknown posted id,
   and the series' withdrawn-run case, merged into one condition `baton.prerequisite-unmet`
   (also raised when a withdrawn ticket leaves an entry unmet — a mild generalisation).
9. **Which blocks refuse an advance**: old text: `ticket` refuses a claim only; `decision` claim
   and advance; `retry` claim and advance (R-BTN-122). `condition`/`call` were unstated; I made
   them refuse claim and advance like `decision`. Kept `ticket` claim-only (faithful). Owner may
   want per-leg `ticket` rows to refuse an advance too — flag for Open questions.
10. **Rule 6** (`operator_only`) folded into rule 4 per R-BTN-132; rule 6 kept as a numbered
    row "(in rule 4)" because code cites rule numbers (`src/core/gates.ts`, `claims.ts`);
    rules 11 and 12 stated "unused", numbers stable. Refusal codes taken from `GATE_CODES` in
    `src/core/gates.ts` (`not-ready`, `claimed`, `held`, `missing-capability`,
    `above-tier-ceiling`, `not-granted`); code still has `operator-only` (target drops it).
11. **Rule 1 at advance** now lists `condition` and `call` rows; SQL predicate generalised to
    "no refusing row on `q` or the whole ticket" (subsumes rule 1's decision and rule 10).
12. **`found`**: "rows a blocked end causes are during-run" generalised to every row a `blocked`
    end writes (incl. `condition`, `call`).
13. **Person legs**: kept the old mechanism that the ticket source posts an open decision on a
    queued person's leg, so the person is listed (posted decisions are on R-BTN-163's floor) and
    reached (`hitl.decision`). Plan item 3 is stated as an intro to §6.4.
14. **Recommendation fields**: R-BTN-45 says "with reasons"; R-BTN-99 (later) removes `score`,
    `reasons`, `advice`. Later wins: Baton's advice flags only (`expedite-bound`, `wip-bound`).
    Advice-flag names taken from code (`expedite-bound`) and R-BTN-98 (`wip-bound`).
15. **Recommendation cache** drops (R-BTN-77, R-BTN-89) removed: R-BTN-98 retired the cache.
16. **`launch-candidates`**, `?all=1` kept under R-BTN-99/§6.6; the hooks-era gate row, rule 12,
    §7.3 roadmap-pr provider logic and rule 1's `claimOrder` detail dropped.
17. **Legacy `released:provider-exhausted`** mapping (R-BTN-126) dropped as transition machinery
    (plan item 8); history should list it.
18. **`budget-spent`** moved from a `retry` `why` value to a hold reason (shown under `other`),
    since `max_attempts_s` is a timer (R-BTN-167).

### §7

1. **The `baton.stalled` default timer vs non-interrupting timers raising `notify` types.**
   R-BTN-167 says a non-interrupting timer raises a `notify` type. Its default timer raises
   `baton.stalled`, which R-BTN-163 makes `suspend` with restarts. Resolution: the default timer
   is the one stated exception.
2. **`max_duration`'s 60 s–7 d range vs a timer's `after_s` of 60 s–30 d.**
   - `after_s` is 60 s–30 d.
   - The owners' ceiling on an interrupting `start` or `first_attempt` timer defaults to 7 days.
     This continues max_duration's 7-day validation bound and `max_attempts_s`'s 7-day ceiling.
   - `extend_to` and `cancel_at` are at most 7 days ahead.

   All of these are stated in the section.
3. **`extend_to` with no `max_duration`.** The rule reads "refused when the claim has no
   deadline". The deadline is the instant of the interrupting `start` timer (`deadline_at`).
4. **The `conditions` ticket source and `GET /v1/sync/choices` are retired** (plan / R-BTN-171).
   - Handler tickets for core conditions, `hitl.decision` included, are real files written by
     the outbox. They are no longer fileless tickets with id `baton.<sub>.<condition_id>`. That
     id form survives only for conditions on a repository or worker; ticket-level ones use
     `<local id>.c<n>`.
   - Choice settlement: no sync read. The override is held until the station changes, and the
     winner's run writes its marker.
   - The supersession trigger "its source stopped posting it" applies only to the `changes`
     source (check tickets, no file).
5. **The `baton.cancel` "runner capability" feature was unspecified** (R-BTN-133 allows only
   `runner:leg-trees`). I defined **`runner:baton-legs`**, required by both `baton.cancel` and
   `baton.write`. **W3/W6 (owner of R-BTN-133): add `baton-legs` to the CLI-defined `runner:`
   values the kit and sync accept.**
6. **"Handled as owner-cancel" vs a new end reason.** The claim ends `released:superseded`, not
   a failed attempt. **W6 (§9 end reasons table): add `superseded` (not a failed attempt).**
7. **Course `notify` vs disposition `notify`.** The course is renamed `announce` everywhere
   (plan item 13).
8. **When conditions close.** This was not stated before. It is needed for "Needs you = open
   unhandled conditions":
   - interrupt conditions close at raise, or when the handler closes if bound;
   - unbound leg-raised notify conditions close at raise (`recorded`);
   - core `baton.<sub>` conditions close when their cause ends.
9. **Severity (R-BTN-125).** Kept only as condition data and debugger order.
   - Posted decisions may still carry `severity`, which `hitl.decision` takes. W4/W2: keep
     `severity?` in `decisions[]` of the board post.
   - `baton.contract` stays `high`, the other core conditions `normal`.
10. **Floor default types.** The old text named "a floor of types never retried" but no default
    list. I stated core's `capability`, `spec` and `contract-input` (their §6.10
    non-retryability). Check this if §9 states otherwise.
11. **`exhausted` leg `next_source`.** The old text gave none. I chose `next_source: retry`, the
    timer leg `timer` (existing) and the outbox leg `outbox` (new).
12. **A call leg's in-claim `wait_s`** was unspecified ("may wait as R-BTN-162 does"). I gave it
    a leg field `wait_s`, default 0, bounded by `max_wait_s`.
13. **`select: "children"`** is not mentioned (plan item 7 retires it). Calls use
    `select: "run"`.
14. **`hitl.decision`** is raised by core although `hitl` is not core-only. It is stated as such
    in the standard-types table.

### §8, §9

1. **`superseded` stop.** Old R-BTN-168 (and §7's copy): "handled as owner-cancel: stop at the
   safe point, push, no hand-off". Old R-BTN-119: owner-cancel stops the leg *at once*
   (SIGINT/SIGTERM/SIGKILL), then `close` and `handoff`. Resolved in R-BTN-119: `requested`,
   `owner-cancel` and `superseded` all stop at once; `close` runs; `handoff` is skipped for
   `superseded` only. **Integrator: §7 R-BTN-168 still says "stops at the safe point"; change
   it to "stops the leg as R-BTN-119 does, without a hand-off".**
2. **Interrupting timer with a `leg`**: not a failed attempt (R-BTN-167 implies it; old §6.10
   was silent). Stated in the end table.
3. **`leg-timeout` reap** counts as the `leg-timeout` end does (so not when the timer names a
   leg). Old text said "is a failed attempt" unconditionally, before timers had `leg`.
4. **Token TTL**: old R-BTN-117 said ≤ 90 days, default 30d; R-BTN-157 says ≤ 30 days, default
   7 days. R-BTN-157 wins. Token role `courier` dropped (personal couriers retired; forge
   couriers are owner-registered SSH keys), so `--role worker` only.
5. **Admin/owner key kinds**: old R-BTN-117 said they stay SSH; R-BTN-159 (later) lets them hold
   API keys. 159 wins; R-BTN-117 no longer says it.
6. **R-BTN-146 / R-BTN-102**: courier flag, delivery, `refused_couriers`, "syncs and delivers"
   all removed (R-BTN-164). Rule is sync opt-in only. `GET …/grants` should no longer list a
   `courier` flag — **W8/W7: drop `courier` from grants and `PUT …/grants/{fp}/flags`.**
7. **Masking list**: R-BTN-128's set and R-BTN-144's additions merged into one numbered list in
   R-BTN-144; R-BTN-128 cites it. R-BTN-118's "a durable log is never Baton's" is reconciled
   with R-BTN-128: Baton keeps pointers only.
8. **Worker vs runner**: R-BTN-3 says a worker is one agent session; the runner hosts the
   sidecar. Stated: a runner is one worker; its leg sessions are children, not workers.
9. **The `runner:` capability for built-in legs**: per the integrator, `runner:baton-legs`
   (W5's choice) is a CLI-defined value beside `leg-trees` in R-BTN-133, required by
   `baton.cancel` and `baton.write`.
10. **R-BTN-26/7 generic wording**: `claim.sh set --status` became "a tool that writes a
    ticket's status to git"; `claude/<item-id>-*` became "a ticket's branch". The holder route
    `GET /v1/runner/tickets/{ticket}/holder` and exit 10 `not-holder` kept.
11. **Activity kind for an in-claim retry**: the old text says "each one is an activity" but
    names no kind. I named it **`in-claim-retry`** (core kind). Integrator/W5: confirm, and cite
    it from R-BTN-122.
12. **Name clash** `resume record` (R-BTN-24) vs `ctx.resume` (R-BTN-162): kept both; one
    clause in R-BTN-24 separates them.
13. **Unacked-release reap (2 h / 15 min)** is stated once, in §9.5 Reaping (and the end table).
    **W4 (§6 messages): cite §9.5 instead of restating the 2-hour reap.** W5's R-BTN-90 states
    the 15-minute `leg-timeout` reap too; that duplicates §9.5 — integrator may cut either.
14. **"Flagged on the dashboard"** (unconfirmed completion 6 h, undone completion) became
    `baton.unconfirmed`.

### §10–§12

1. **R-BTN-16's one cookie vs R-BTN-155's pending cookie** → two cookies, both `__Host-`,
   host-only, `Secure`, `HttpOnly`, `SameSite=Strict`: session `__Host-baton_session` (≤4 h; the
   name is from `src/core/http.ts`) and pending `__Host-baton-pending` (2 min; the spec's name).
   The underscore/hyphen mismatch is kept as found — B-46 may align the names. R-BTN-16's "12
   hours" → 4 hours (R-BTN-155).
2. **R-BTN-155's touch-key confirmation vs admin API keys (R-BTN-159)** → the later rule wins:
   any administrator key, SSH or API, binds sign-in codes and confirms dashboard actions. §11.4
   states that the confirmation protects against a same-user process only with a touch-required
   key. Candidate owner decision (not taken): refuse `admin.confirm` and code binding to API-key
   administrators.
3. **R-BTN-157's token role `courier`** → dropped: personal couriers are retired, forge couriers
   are owner-registered SSH keys. W6 agrees (`--role worker`). G-BTN-144's "worker or courier
   only" needs the same edit (W9).
4. **R-BTN-129 scopes `asks` (courier labels) and `instances` (probe allowed instances)** →
   dropped: courier labels are retired, and an instrument key reports on any registered instance
   (R-BTN-101). `owner.courier.revoke` stays (forge couriers).
5. **Dashboard actions (§14 vs R-BTN-155).** `cancel` is listed as dashboard-alone: it is a hold
   plus a `release`, both in R-BTN-155's unconfirmed class; as `ticket.cancel` it is destructive,
   so the dialog sends `confirm: true`. **Gap filled:** resolving a condition from the dashboard
   (`owner.resolve`, R-BTN-163) is added to the confirmed list — it changes authority (a `retry`
   resumes work). Flag for review.
6. **Check-head supersession** (R-BTN-114/153 "supersedes every claim") is written with R-BTN-168's
   release reason `superseded`. Flag if W5/W6 intended another reason.
7. **Forge-check notice retention.** R-BTN-80's "closed" state and `closed` answer belonged to
   decision notices; dropped. A sent `forge-check` notice is deleted after 7 days (R-BTN-80 kept
   sent notices while their decision was open — no decision exists for a check). Assumption.
8. **`api_keys: false`** refuses API-key workers and MCP keys (R-BTN-117, R-BTN-130), not owner or
   administrator API keys (which would lock owners out). Admin/owner API keys have no TTL or idle
   expiry; they last until revoked or removed. Both readings are my resolution of text written
   before R-BTN-159.
9. **Check-runner credential kind** was never stated; written as an SSH key (like the forge
   courier and sync keys, which guard what agents must not reach). Flag.
10. **R-BTN-163's dashboard resolve** and R-BTN-127's table: `owner resolve`, `leg raise`/`await`,
    `runner accept-grant`/`decline-grant`, `key create` and `decision list` (conditions route,
    signed by owner, granted worker or administrator) are in the CLI table; the "Was" column and
    the "renamed:" old-name behaviour are dropped (transition, plan item 8).
11. **§10.4 hook caps** (4 KB advice, 1 MB module) and `blocked_by` refs dropped (hooks retired;
    `blocked_by` is window machinery). The `ROLES` "legacy name" in R-BTN-157 dropped (window).
12. **Constant-time comparison** is stated once for every bearer secret and MAC (§12.1),
    generalizing R-BTN-156's and R-BTN-159's statements.

### §13, §14

1. **`leg_logs.claim_id`** was declared TEXT but references the INTEGER `claims.id`. It is an
   integer (§13's convention: `claim_id` is an integer).
2. **`dashboard_sessions`.**
   - Keyed by `id_hash` of the whole cookie, against R-BTN-135's `bds_<id>_<secret>`. I keyed it by
     `id` with a `secret_hash`, so failure buckets can name the id.
   - "+12 h" against R-BTN-155's 4 h: I used ≤ 4 h.
   - `login_codes` is likewise keyed by the `id` of the pending sign-in `bps_<id>_<secret>`.
3. **`mcp_keys` id.** R-BTN-130 makes a key `bmcp_` plus 32 base32 bytes, with no id part.
   R-BTN-135's failure buckets name "the `<id>` of a `bmcp_` bearer". I keyed the table
   `(repository_id, name)` with a unique `key_hash`.
   - **Integrator:** either give MCP keys the `bmcp_<id>_<secret>` form (R-BTN-130, §11) or drop
     `bmcp_` from R-BTN-135's bucket ids.
4. **`course_schemas`.** The spec says keyed `(repository_id, id, version)`; the code keys
   `(repository_id, id)`, where `id` is `<course>:<name>@<n>` and so includes the version. I used
   the code's form, which carries the same information.
5. **`notices.kind`.** The CHECK allowed only `decision` and `queue-over`, yet the table serves only
   `forge-check`. The kind column is gone: every notice is `forge-check`.
   - The columns are per-notice fields: `sha`, `name`, `seq`, `check_id`, and the signed body in
     `payload_json`.
   - States are `queued`, `claimed` and `sent`. `closed` was a decision-notice state, so the error
     code `closed` is dropped too.
   - `channel` is dropped from `POST /v1/courier/notices/{id}`; it was a personal channel's label.
     Restore it if the forge courier needs a label.
6. **`hold_reason`.**
   - The CHECK lacked `budget-spent` (R-BTN-167) and `mcp:<name>` (R-BTN-154). Both are added.
   - `non-retryable:<class>` becomes `non-retryable:<type>`, since a class is now a condition type.
7. **`repositories.retry`.** The column comment still had R-BTN-23's `{backoff_ms, max_failed}`.
   It is described only as "the default policy, its ceilings and floors (R-BTN-122)". W5 owns the
   shape.
8. **`events.kind`.**
   - Dropped: `hook-failed` and `queue-over` (the latter is now `baton.queue-over`, logged as a
     `condition` event).
   - Added: `condition`, `choice-settled`, `call-settled`, `superseded`.
   - Kept: `attempts-exhausted`, because the code writes it.
   - `shadow-conflict`, `foreign-claim`, `cutover` and `adopted` are tagged *adoption*.
9. **`ticket_blocks.kind`, `messages.kind`, `next_source`.** Each CHECK now lists every later value.
10. **Credentials.**
    - `credentials.kind` gains `check-runner`. R-BTN-114 gives check-runners their own key role,
      and `check_runners` references a credential.
    - The `pool` row and `allowed_instances` are gone.
    - The kind names `worker` and `probe` stay, as the code uses them; the table says what each
      means.
11. **`worker_grants.courier`** and the grant-flag route's `courier` are dropped (worker couriers
    are retired). `GET …/grants` no longer returns `courier`.
12. **Registration-token roles.** These were `worker` or `courier`. A courier token registered a
    personal courier, which is retired, and forge couriers are owner-registered SSH keys. The role
    is `worker` only.
    - **Integrator / W6:** R-BTN-157's text should say so.
13. **`claims.advice_json`** is retired with course advice. R-BTN-100's `rationale` is kept as
    `claims.rationale_json` (≤ 4 KB, opaque, exported with the claim).
14. **`ticket_decisions.source`** (`baton` rows) is gone; Baton's own decisions are conditions.
    `pending_owner_state.kind` is now `override` | `condition`, replacing `decision`.
    - **W2:** R-BTN-88's export sections should carry open core conditions instead of
      `ticket_decisions (source baton)`. W2's 04.md line ~395 already lists conditions, timers and
      the outbox.
15. **`tickets.depends_on`, `blocked_by` and `operator_only`** are not stored (R-BTN-132).
16. **`POST /v1/admin/probes`** drops `instances[]`, since `allowed_instances` is retired
    (R-BTN-101).
17. **`POST /v1/owner/{repository}/tickets/{ticket}/resolve`.** Its old wire shape was
    `{decision: 'baton:retries', answer, leg?}`, which §2q never restated.
    - I defined `{restart, condition_id?}`, with `condition_id` required when the ticket has more
      than one open condition taking a restart.
    - `restart` is `retry`, `route:<leg>`, `park` or a declared restart id.
    - **The code is still on the old shape.**
18. **§2m.7a's path forms.** It wrote `/v1/runner/advance` and `/v1/runner/end`. The code and the
    old §11 use `/v1/runner/claims/{id}/advance|end`, and so does §14.

### §15

1. **G-BTN-82 vs R-BTN-102.** G-BTN-82 said "a worker key is never a sync's"; R-BTN-102 says a machine key may sync. G-BTN-82 now says "a machine key the repository lets sync". S-BTN-55 now has the machine key post with `machine_sync` off.
2. **G-BTN-69 vs R-BTN-134.** G-BTN-69 said "defaults in the CLI"; R-BTN-134 says the CLI ships no course. The default *ticket source* is the CLI's, and the course is `create-pr`, read from its source.
3. **G-BTN-57 and G-BTN-12 vs R-BTN-155.** Both gates still described the one-time login link. Sessions now come from a sign-in code that an administrator key confirms (R-BTN-155).
4. **`select: children`.** The selector is retired (plan), which affects four rows:
   - S-BTN-49 and G-BTN-76 drop the parent's provisional `spawned` block, matching W4 #6 and W2. An open child blocks its parent only through a call.
   - S-BTN-72 now uses `parent` and `depends_at`.
   - S-BTN-108 uses a call leg.
   - S-BTN-51's series retires once its pending run is withdrawn, with no fan-in, matching W4.
5. **`epic` (integrator).** `epic` is now two call legs, `plan` and `replan`, with `built` ← all done, then `planned` ← all closed.
   - S-BTN-89, S-BTN-132 and G-BTN-109 match this.
   - `baton.call-empty` is gone: a `spawned` end naming none is refused (S-BTN-132, G-BTN-150).
6. **The `max_duration` family.** S-BTN-52 now uses an interrupting `start` timer of 1,800 s. S-BTN-87 uses a `first_attempt` timer (`budget-spent`) and a `ready` timer (`baton.ready-late`). S-BTN-134 and G-BTN-152 say the old fields are refused.
7. **S-BTN-84 and G-BTN-106.** `error_types` are now declared `interrupt` conditions. An untyped error is `error.transient`.
8. **The legacy `provider-exhausted` half** is dropped from S-BTN-95 and G-BTN-115 (migration). G-BTN-44's list of ends that are not failed attempts drops it too.
9. **G-BTN-70 and refusing blocks.** I wrote "every kind but `resource` refuses". W4 #9 says `ticket` rows refuse a claim but not an advance. If W4's §6 states that, the integrator should tighten G-BTN-70 to "refuses as R-BTN-75 says".
10. **G-BTN-144 tokens** are "worker only", because W7 dropped the token role `courier`.
11. **Condition sub names.** I used W2's, W4's and W5's names where they gave them: `baton.prerequisite-unmet`, `baton.capability-missing`, `baton.head-replaced`, `baton.queue-over`, `baton.output-invalid`, `baton.check-mismatch`, `baton.check-unattested`, `baton.repo-not-listed` and `baton.outbox-late`. Elsewhere a row says "raised". The integrator may want exact subs there, e.g. for S-BTN-25's `foreign-write` and S-BTN-95's worker.
12. **S-BTN-97 and G-BTN-117** lose the twelve old command names (migration). The cases that remain are about the current command tree.

### Integration

- **R-BTN-17** is the mirror's precondition rule and is defined once, in §16 (it was drafted in §9 too).
- **`epic`'s `replan`** waits on the replacements it files because `replan` is itself a call leg; the
  completion option `"closed": true` (every child closed, done or withdrawn) was added to R-BTN-165 for
  it, and `baton.call-empty` was dropped: a `spawned` end naming no children is refused.
- **A refused push in `baton.write`** ends `released:blocked` on `runner:baton-legs`, not
  `cannot-finish:capability`, which would have held the ticket.
- **A superseded claim** stops as R-BTN-119 does, without a hand-off.
- **Delivery runners** use capabilities `channel:push` and `channel:email` (not `courier:*`), so
  "courier" names only the forge courier.
- **Core conditions on no ticket, repository or worker** (`baton.sign-in-burst`,
  `baton.bearer-over-http`) sit on the tenant.
- **The ticket-id rule** cited by §4 and §6 is stated in §12.3 (Identifiers).
- **"Worker" is retired as a term** (owner, 2026-10-20: "worker is used for so many other things, it's
  an overloaded term"). Every process that can execute a leg is a **runner**: an **interactive
  runner** (an agent harness session through its sidecar) or a **CLI runner** (`baton runner
  start`). "Worker" remains only for the Cloudflare Worker that hosts Baton. Identifier renames
  are listed under migrations.
- **Call legs never wait in their claim.** Baton learns a call's children only from the end that
  carries `spawned`, so an in-claim wait could never settle; the call leg's `wait_s` was dropped.
- **Who drains the outbox.** A runner declares `runner:baton-legs` only when started with
  `--outbox`, its operator vouching for push access; a refused push is a misconfiguration, ending
  `released:cannot-finish:capability` with the ticket held and `baton.retries` naming the runner.
  (A drafted alternative, ending blocked on the capability, was rejected: `runner:` capabilities
  have no check, so the runner would re-declare at once and loop into `blocked-exhausted`.)
- **"Baton holds no git credential"** means it never uses one to write git. The deployment's
  dispatch credentials start workflows only; a Gitea bot token, which Gitea cannot scope below
  write, is a stated exposure held as a Worker secret (R-BTN-94, R-BTN-171).
- **Moving a Baton** (R-BTN-88) also carries `check_runners`, `mcp_keys`, `instance_settings` and
  unexpired `registration_tokens`, which the old export list predated.
- **A call leg reaches an end without a settlement** (`epic`'s `replan` → `abandoned`) through a
  `null` entry in its completion table (R-BTN-165).

### Schema review (2026-10-20)

An adversarial review of the course-file schema for overlapping concepts (owner approved all
changes):

1. **`call: {condition}` removed, then `call` itself** (R-BTN-69, R-BTN-111, R-BTN-165): no course
   or scenario used the condition form, and its completion table could not name the stations of a
   course a binding chooses; a call leg is `kind: call` with `spawns` naming the courses it calls.
2. **`isolation` merged into `requires.capabilities` as `runner:session`** (R-BTN-107, R-BTN-133,
   §6.6, R-BTN-104, R-BTN-114, R-BTN-147; S-BTN-64, S-BTN-123, G-BTN-90): rule `isolation` is
   rule 4; a session-only leg with no session runner now shows a `capability` block.
3. **`retry.non_retryable` removed** (R-BTN-122, R-BTN-160): `retryable` on the declaration alone
   decides, which removes the undefined class of a retryable type made non-retryable per leg.
4. **Course-file `checks` removed** (R-BTN-69, R-BTN-114, §5.7; S-BTN-68): an inert copy of the
   binding owners' setting; the kit prints a check course's end stations instead.
5. **`select: "run"` removed from `requires.tickets`** (R-BTN-120, R-BTN-86, R-BTN-165; G-BTN-127,
   S-BTN-108): undefined outside a call; `build-app`'s `file` and `verify` became call legs
   (R-BTN-131; S-BTN-107, G-BTN-126).
6. **An interrupting timer with `leg` on a choice station's leg is refused** (R-BTN-167, R-BTN-69,
   §5.7; S-BTN-134): it was a kit warning, and the claim that it "says the same thing" as
   `after_s` was wrong — a timer yields to git (`route-overridden`), a choice does not
   (`choice-lost`).
7. **Gap (a), `max_blocked`** is the owners' bound alone, not a "ceiling" over a course value
   (R-BTN-122).
8. **Gap (b), attempts and the `first_attempt` budget reset when the leg reaches an outcome**, as
   well as on a hold lift, so loops do not accumulate failures across passes (R-BTN-122,
   R-BTN-167, §9.7, §13; S-BTN-6, S-BTN-87, G-BTN-107).
9. **Gap (c), `renamed_from` carries every per-leg record** — attempts, timers, blocks, needs, next
   legs, posted bars, held positions (R-BTN-64, §13; S-BTN-37, G-BTN-64).
10. **Gap (d), overriding core's default timer** is a leg timer `{after_s, from: "arrival",
    interrupting: false, raise: "baton.stalled"}`, one per leg (R-BTN-167; S-BTN-134).
11. **Gap (e), contradictory timers are refused** by the validator and the kit: interrupting with
    `raise`; non-interrupting with `leg` or without `raise` (R-BTN-167, R-BTN-69, §5.7;
    S-BTN-134, G-BTN-152).
12. **Gap (f), a choice leg's `after_s`** takes a timer's range (60 s–30 d) and is held in
    `ticket_timers` from the ticket's arrival at the station, exported, restarting only when the
    station changes (R-BTN-166, R-BTN-167, R-BTN-120, §13; S-BTN-50, S-BTN-133, G-BTN-151).
13. **Gap (g), R-BTN-147** raises `baton.machine-loosened` for a dropped `stream: false`, and a held
    post may add one (S-BTN-121).
14. **Gap (h), `spawns.course`** may name several courses or `"*"`; `build-app` calls over `"*"`,
    with completions using `done`, `withdrawn` or `closed` (R-BTN-111, R-BTN-165, R-BTN-131).
15. **Gap (i), a person's leg's decision carries the leg's `asks`**: Baton stores the course's
    value and logs `asks-mismatch` when the post differs (R-BTN-116, §13; S-BTN-67, G-BTN-90).

### Adversarial review (2026-10-20), adv-3.md

§8–§10 (runners, claims, checks).

- F1 (major) fixed: a fence-reap stores `fence_deadline` (reap + lease timeout) and the alarm clears the fence then, whatever the runner does; only the silence reap sets `reaped_at`; `baton.fence-pending` at 30 min (R-BTN-19, §9.5, R-BTN-90, §13; S-BTN-4, G-BTN-14).
- F2 (major) fixed: every reap of a claim running a `session`-mode leg is fence-pending, `fenced` only after the provider confirms the interrupt, else the deadline; layer 1 interrupts the child; the unreachable-child residual stated (noticed as `foreign-write`, R-BTN-46) (R-BTN-19, §9.2).
- F3 (major) fixed: both holder queries take `session_name` and the runner secret and answer relative to that runner; asked by the key alone, every active claim counts as another's (§9.2, §14).
- F4 (major) fixed: the claim response's `base_sha` must be an ancestor of `snapshot_sha` (no roll-back, R-BTN-143); a check's `check_command` is read from the default branch's fetched tip (R-BTN-153); a machine key's `head_unfounded` post is held (R-BTN-147); S-BTN-123.
- F5 (major) fixed: a `check_runners` row stands in for a grant (capabilities, `max_tier`; rules 4, 5, 7), the hostname binds at `check-runner add --name`; powers restated in §12.1; `not-queued` and `check-runner` named as gates (§6.6, §13, §14; G-BTN-103).
- F6 (major) fixed: a supersession (a changed `check.sha` included) marks a completed-unconfirmed claim `superseded_at`: never confirmed, concludes nothing, no attempt, no longer rule 3 (R-BTN-168, R-BTN-114, §9.6, §13; S-BTN-68).
- F7 (major) fixed: the courier reads the sha's runs and skips a notice when a higher `seq` is posted; read-back raises `check-mismatch` on a stale newest run and re-queues the highest notice (R-BTN-115; S-BTN-68). The proposed refusal of a mark after the lease lapsed is not taken: with the pre-post read a late mark is harmless, and refusing it would only re-deliver.
- F8 (major) fixed: `baton.station-jump` is raised on any accepted post, not only a machine key's, for an arrival with no `claim_legs` row (person legs and settlements excepted); a suspension is confirmed only when arrivals beyond its expected path are such legs (R-BTN-147, R-BTN-71, R-BTN-10; S-BTN-25). The marker-nonce variant is not added; these two cover it.
- F9 (minor) fixed: delivered, unacknowledged messages are re-sent on every heartbeat and acted on once per id (§6.9, §8.1).
- F10 (minor) fixed: the sidecar fences on the lowest timeout in force at `last_ok` or declared since (R-BTN-9).
- F11 (minor) fixed: a resume-named branch is continued only if it matches this ticket's current or previous `branch_pattern` (R-BTN-25).
- F12 (minor) fixed: the claim nonce is declared public; dropped from masking and the state-view exclusion (R-BTN-144, §9.1, §13).
- F13 (minor) fixed: the runner drains its spool before `end`, a grace-period close carrying `resume` rewrites `resume_json`; `previous_attempts` capped at the newest 10 plus `previous_attempts_total` (R-BTN-24, §14).
- F14 (minor) fixed: claim idempotency is keyed by `(runner_id, request_id)` (§9.1, §13; G-BTN-2).

### Adversarial review (2026-10-20), adv-1.md

§1–§4 (what Baton is, deployments, repositories and forges, tickets and the board).

- M1 (major) fixed: "founded" means the head and `new` lie on one line; a `new` strictly behind the head (a lagging fetch) posts nothing and releases its number with `behind`; after 30 minutes behind (`board_head.behind_since`, `behind_confirmed`) the sync posts a force post, which is held; only a diverged or absent head is `head_unfounded`; a force post naming an accepted snapshot's sha is never adopted at once (§4.3, R-BTN-147, §13, §14; S-BTN-121, G-BTN-141).
- M2 (major) fixed: accepting a held row (administrator or alarm) only sets `accepted_at` and drops the repository's other held rows; the next force post of that sha with a newer observation is adopted with its own board; the alarm accepts only the newest held row; a held row whose sha an accepted post `contains` is dropped; the alarm row is in §2.1 (R-BTN-11, §4.4, §13; S-BTN-121).
- M3 (major) fixed: the tighten-only list names the real fields — `stations[].bars` only grow, `decisions` only added, `next[].state` only `ready`→`waiting`, plus tier, `requires`, `depends_at`; a held post's `closed` is ignored and its omissions drop nothing; R-BTN-62's refresh takes positions and markers (R-BTN-62, R-BTN-147; S-BTN-121).
- M4 (major) fixed: R-BTN-33 lists the opaque blobs as the other inline values with §12.3's caps and states core cannot keep prose out of them; the markdown source no longer posts `prs` or `answer` — they are sync-local `fields` station functions read (R-BTN-33, R-BTN-74, §5.8).
- M5 (major) fixed as the owner decided (decision 3): no inherited holds; R-BTN-66 states that a hold binds a ticket id only as firmly as git keeps it, pointing to R-BTN-12's residual-risk text and the listing of the old id's held `closed` row.
- M6 (major) fixed: markers are never refused; past 20 per ticket or 20,000 in all the sync posts the newest and lists the cut tickets in `markers_truncated`; markers gate nothing (R-BTN-149, §4.4; S-BTN-122).
- M7 (major) fixed: "author gate" defined (the `requires` and tier gates over `declared`); a claim settling at `start` with a posted-state gate failing ends `stale-board`, no failed attempt, branch tainted when the settling post is at the claim's sha (R-BTN-104; S-BTN-121, G-BTN-59, G-BTN-141).
- M8 (major) fixed: the longest matching id wins a branch, in the fact adapter, station functions, the local branch check and the branch-holder query; an unposted child's branch maps to its parent until its first snapshot (R-BTN-141; S-BTN-49).
- m1 (minor) fixed: a post is `stale-observation` unless its number was issued to the posting credential (R-BTN-62; S-BTN-122).
- m2 (minor) fixed: `POST /v1/sync/observation {release, behind?}` gives a number back on every no-post exit; a lapse is a number voided for idleness or age, never posted or released (R-BTN-150, R-BTN-139, §14; S-BTN-122).
- m3 (minor) fixed: the open-world bar is per ticket, for every key; `open_world_bars` is keyed by ticket with the setting credential as a column (R-BTN-148, §13).
- m4 (minor) fixed: §2.1's idempotency promise is limited to claims' `request_id`; every other write names how a retry is safe; §2.3's retry keeps a `request_id` only where the route takes one.
- m5 (minor) fixed: admission at `/v1/sync/*` takes a sync key's or a machine key's signature (§2.3).
- m6 (minor) fixed: §1's runner definition, R-BTN-94's "Who answers a want", R-BTN-97's "a machine", and `cloudflare:*` in §2.1 and G-BTN-56.
- m7 (minor) fixed: a push is dropped only when its pusher is the repository's `mirror_pusher` and its author email the mirror's; an email alone drops nothing (R-BTN-73, R-BTN-47, §13, §14, §16.3; S-BTN-56).
- m8 (minor) fixed: a heartbeat's declaration and report writes count against a per-credential daily budget (50,000); past it the lease is kept and the changes dropped (`declarations: 'quota'`) (§2.3, R-BTN-149; S-BTN-122).
- m9 (minor) fixed: `branch` verdict commits carry `Baton-Claim: <nonce>` and are posted as markers, so an unclaimed verdict logs `foreign-write` and still counts (R-BTN-96, §4.4; S-BTN-54).

### Adversarial review (2026-10-20), adv-2.md

§5–§7 (courses; prerequisites, blocks and advice; conditions).

- B1 (blocker) fixed as the owner decided (decision 1): R-BTN-163's owner-signed-commit answers removed; a `baton.*` condition is answered only through `baton owner resolve`, an owner's or administrator's dashboard session, or an MCP key allowed `owner.resolve`, never through git; a bound handler only delivers a deep link to the dashboard's Resolve page `/conditions/<condition_id>` (`resolve_url` in `std:condition@1`; §11.4); R-BTN-63's traversal record kept; Decisions line revised; B-75 rescoped (S-BTN-131).
- M1 (major) fixed: a light question's text is pushed before the report as a parentless commit holding `question.md` on `refs/baton/questions/<local id>/<commit sha>`; the report carries the `question` pointer, Baton stores only it, and a promoted ask's body is its text (R-BTN-160, R-BTN-161, R-BTN-173, R-BTN-171, §13, §14; S-BTN-138, G-BTN-146).
- M2 (major) fixed: a Baton-held ticket's children are Baton-held — its `spawned` end carries `{local_id, course, input?}`, Baton creates them, and they are never `spawned-unposted` (R-BTN-173, R-BTN-86; S-BTN-138).
- M3 (major) fixed: R-BTN-5's git re-verification applies to claims with a ticket file; built-in legs and fileless tickets (Baton-held, `changes` checks) are re-verified against Baton's record (R-BTN-5, R-BTN-173).
- M4 (major) fixed: a promoted ask's frontmatter carries `baton_position: {station, path}`, which the CLI's station-function library reads as closing markers, so it is posted at `waiting` and `open` is not re-run; the row, arrival instants and `deliver` child are kept; `baton_held` clears when the entry lands (R-BTN-173, R-BTN-171, §13; S-BTN-138).
- M5 (major) fixed: R2 generalised to every `suspend` condition — any end of a waiting claim other than the consuming one, and any reap (`leg-timeout` included), writes a non-provisional `condition` block (R-BTN-162, R-BTN-173; S-BTN-128, G-BTN-147).
- M6 (major) fixed: R-BTN-83's held positions name the built-in legs' clearing events (`outbox`: the snapshot posting the ticket, or posting it withdrawn or closed; `cancel`: withdrawn or closed) and that they report no position (R-BTN-83, R-BTN-12, §13; G-BTN-73).
- M7 (major) fixed: a `written` entry is never handed out again; the ticket then waits Baton-side on `outbox`; an entry not `landed` after 3 snapshots holds the ticket `outbox-unlanded` and raises `baton.outbox-late`; lifting the hold re-queues it (R-BTN-171, R-BTN-12, §13; S-BTN-136).
- M8 (major) fixed: an entry handed to a claim is `claimed`; a claimed `handler` entry whose condition closes is dropped but its row kept until the claim ends, a reported write being followed by a `withdraw`; dropping a handler entry drops its `answer` entries; an unreported held entry returns to `queued` (R-BTN-171, §13; S-BTN-136).
- M9 (major) fixed: a completion table's last non-null entry must be `{"of": "all", "closed": true}`, so every call settles; the validator and `baton course test` refuse one without (R-BTN-165; S-BTN-132).
- M10 (major) fixed: rule 1's advance form refuses on a `ticket` row on the leg or the whole ticket; R-BTN-75's `ticket` row binds advances (§6.6, R-BTN-75; S-BTN-72).
- M11 (major) fixed: a core `notify` condition re-raised within an hour of the same one closing, or past 20 `handler` entries a repository an hour, files no handler and is unhandled, counting `reraised` / `outbox-throttled` (R-BTN-163; S-BTN-131).
- M12 (major) fixed: the board post carries top-level `bindings` (the repository scope); runner- and tenant-level core conditions are never bound (§4.4, R-BTN-163, §13; S-BTN-131).
- m1 (minor) fixed: legs may not raise or declare `baton`, `baton.*` or `hitl.decision`; the raise route answers `invalid-params` (R-BTN-160, §14; G-BTN-146).
- m2 (minor) fixed: a handler id over 64 characters becomes `c<condition_id>`; `.c<n>` and `c<n>` ids are reserved (the markdown source skips such a file without `handles`); a handler write never overwrites a foreign file (`cannot-finish:spec`, or `outbox-collision`) (R-BTN-161, R-BTN-171).
- m3 (minor) fixed: a ticket leaving a leg's station or closing with a settled, unrecorded light answer writes the closed ask with its answer through the outbox (R-BTN-173; S-BTN-138).
- m4 (minor) fixed: `answered_by` is a channel's opaque id (`<channel>:<id>`), shown as reported by a claim via a channel, never a verified identity (R-BTN-173, §13).
- m5 (minor) fixed: `resume` is a list everywhere with `answered` in its outcomes; the end's `written` carries `skipped`; R-BTN-69 lists `light` and `answers`; the `replaces` binding form is given; `human-operator` is a bare built-in capability (R-BTN-162, R-BTN-161, R-BTN-69, R-BTN-121, R-BTN-171, §9.1, §14).
- m6 (minor) fixed: each finished compensation is recorded in `claim_legs` and a later `baton.cancel` skips it (R-BTN-168; S-BTN-132).

### Adversarial review (2026-10-20), adv-4.md

- B1 (blocker) fixed, per owner decision 2: owner dashboard sessions integrated — principal `owner-session` (scope: the repositories its minting key still owns; never an administrator) in R-BTN-129; `dashboard_sessions` gains `role`, `key_fingerprint`, `repositories`, and `login_codes` a `role` set by `POST /v1/login {role}`, so a code binds only through its own role's route; `POST /v1/owner/login-links`, `POST /v1/owner/confirm`, `POST /v1/owner/sessions/revoke` and `POST /v1/ui/conditions/{condition}/resolve` added to §14, the owner resolve route no longer lists sessions, administrator-only `/v1/ui/*` routes marked *admin session*; confirmation only by the minting key; one confirmed-action list for both roles (Stop, cancel and resolve one click; OAuth `leg.stop` approval confirmed); a session dies with its minting key's role; §11.2, §11.4, §12.1, G-BTN-57, G-BTN-144 updated; S-BTN-124 extended; B-76 and B-73 updated.
- B2 (blocker) fixed, per owner decision 3: a ticket leaving the board (closed or dropped) keeps its `ticket_overrides` row and `leg_attempts` in `closed_tickets.kept_json` (new `closed_as: dropped`), restored when the id returns; §13's cascade enumerated; the residual risk of a re-filed new id stated, with the old id's held row listed on Courses (R-BTN-12, R-BTN-147, §4.4, §13; S-BTN-39 extended).
- M1 (major) fixed: `admin.key.revoke` removes an owner key from every repository (ending its sessions and MCP keys) and refuses an administrator's key, which ends only by leaving `BATON_ADMIN_KEYS` (R-BTN-57, R-BTN-159, §14; S-BTN-32).
- M2 (major) fixed: consents live in `code_repo_consents`, written only by the consenting repository's owner route or an administrator's `code_repo_consents_add`; owners write `code_repos` paths only, Baton owns `repo_id` and `former_paths` (R-BTN-140, §13.1, §14; S-BTN-116).
- M3 (major) fixed: only a bearer whose secret fully verifies is revoked over `http`; others are refused and counted (R-BTN-158; S-BTN-124).
- M4 (major) fixed: G-BTN-57 now says a machine key's grant may sync and post readings for instances listing a granted repository, never holding the instrument, sync-key or mirror role.
- M5 (major) fixed: `adoption_requests` table; `adopt` answers `{pending: true}` until the named runner's request is confirmed (`{runner_id}`); legacy runners exempt from `(hostname, session_name)` uniqueness and from lease expiry, `reap_after` in the alarm list (§16.1, §13, §14; S-BTN-16).
- M6 (major) fixed: the owner routes added; §13 and §14 include `BATON_MCP_OAUTH_SPEC` §12–§13 by reference until B-73 folds them in; the raise's `handler_id` was already in §14.
- m1 fixed: the mirror's `after` is clamped to the last `seq` returned (§16.3, §14).
- m2 fixed: `accept` takes `{confirm_span?}`, else `conflict` listing the repositories (§14).
- m3 fixed: `owner.sync-key.revoke` (and `owner.sessions.revoke`) in §12.2.
- m4 fixed: a never-accepted pending grant's key holds no role; `conflict` names no role; administrator lines checked by `baton admin keys set` and at load (`baton.admin-key-conflict`) (§12.1, §13.2; S-BTN-32).
- m5 fixed: Access covers only the dashboard's pages, `POST /v1/login` and `/v1/ui/*` (R-BTN-16).
- m6 fixed: `/v1/ui/messages` takes only `release` and `status_request`, the release's holder checked (§14; S-BTN-124).
- m7 fixed: MCP rate limits count in the tenant's object.
- m8 fixed: `bmcp_` keys, which have no id, count only in the (origin, client IP) bucket (§2.3).
- m9 fixed: Open questions lists confirmation by keys a same-user process can reach; the MCP id flag is closed by m8.
- m10 fixed: `reading-refused` and `invalid-pointer` added to `events.kind`; `answer-unsigned` no longer exists (owner decision 1).
- m11 fixed: §16.3 cites §12.3 and R-BTN-17 for the lint, and writes R-BTN-12's hold Status note.
- m12 fixed: G-BTN-117 signs as the first role in `callers` the user holds a key for.
- m13 fixed: API keys also reach `GET /v1/stream` and `GET /v1/actions` (R-BTN-159).
- m14 fixed: G-BTN-55 cites S-BTN-30 and S-BTN-126.

## Decisions in full

- **A per-repository capability ontology in one named fragment of ASP-Core-2, evaluated in core**
  (2026-10-22, owner; R-BTN-174, R-BTN-175). Holdings are labels and the ontology maps them, so
  core learns no provider and stores no credential. The alternatives rejected:
  - **Capability names alone**, the state before this change: every runner must declare every
    altitude a leg might require.
  - **A flat conjunct-of-strings rule format** cannot express the owner's join over a model
    class.
  - **Compiling rules at the sync to fixed shapes** (reachability plus first-match, the third
    iteration). Core could then run only what the shapes allow, which contradicts "model-choice
    logic implemented in a repo".
  - **A solver in the Worker** (clingo-wasm: megabytes against the size budget, a cold start per
    isolate, NP machinery for a polynomial need) or **beside it** (a sidecar: core egress, and
    infrastructure Baton needs beside it).
  - **N3 as the semantic reference.** It has no stratified negation or preference, and the
    second iteration's promotion of it was reversed by the third.

  The evaluator is general but bounded by counts, never time. Validation runs it on the gate
  stratum's maximal input, which bounds every runner's evaluation because the stratum is
  monotone in holdings. Its result is stored per runner when its inputs change, never computed
  at a claim, so one repository's program cannot stall a tenant's claims. Interpreting a
  program this total is not running repository code, as interpreting a course file is not. Only
  cycles through negation are refused: positive recursion is transitivity, and refusing it, as
  the first iteration did, would have refused the generic transitive rule. The grant bounds the
  holdings before the closure, because bounding the derived set after it would remove every
  derived capability under concrete grants.
- **The language grows only by ASP-Core-2 constructs** (2026-10-22, owner; R-BTN-175). The owner:
  "I want to ensure we are growing ontology language in the direction ASP core two allows us to
  grow. This means I do not want to have workarounds using preferences for logic that belongs in
  the ontology." Positive rules are monotone, so a binding beside an unconditional rule could
  never narrow it. Narrowing is therefore default-with-exception, and functional bindings are an
  integrity constraint in the built-in ontology rather than hard-coded validation. Rejected: folding
  bindings into one-alternative choices, which would make a gate's narrowing depend on advice;
  and keeping bindings as a separate gate mechanism beside choices.
- **Choices as ASP-Core-2 weak constraints, evaluated as first-match** (2026-10-22, owner;
  R-BTN-176, R-BTN-177). Availability is hard and guards are soft. The fourth iteration's
  "skip failed guards, take the first" could not make DeepInfra's outage outrank OpenCode Go's
  peak: a dropped alternative cannot serve as the fallback. Positions are a strict order, so the
  optimum is unique and conformance compares one projected atom, never full answer sets.
  Hysteresis reads the last demotion, stored per (repository, choice, alternative). Two
  thresholds over one stateless reading cannot tell which applies. The rejected alternative was
  an instrument that debounces, which would move hysteresis out of the ontology and into every
  instrument. Fractions are fixed-point integers (clingo has no other numbers), and reading
  atoms are typed by predicate, so the evaluator and clingo never compare across types. Atoms
  are keyed by instance, since readings belong to instances, with R-BTN-76's precedence choosing
  one speaking reading. Peaks are repository rules over `now`, not core's provider tables.
- **Readings steer advice only from administrators and instrument keys unless a resource admits
  runners** (2026-10-22, owner; R-BTN-176). An instrument that may report for an account can
  steer every listed repository's routing with in-schema lies (a quota reported as full keeps
  draining it). Admitting runners is a recorded trust decision per resource. Readings never reach
  a gate, so the harm is bounded to advice. Rejected: atoms from every reporter the spec already
  accepts.
- **Derivation is not bounded by the grant** (2026-10-22, owner; R-BTN-174). A capability gate
  matches what a runner can do, and Baton cannot make a runner do anything (R-BTN-66), so a
  program that derives an ability the runner lacks harms only that runner, which is offered legs
  it cannot finish. Authority is not derived: grants, `human-operator` and `runner:` stay outside
  the ontology. Rejected: intersecting D(H) with the grant, and an owner setting that lists the
  derivable types. Both would treat a statement of ability as a grant of authority.
- **The ontology passes no credential** (2026-10-22, owner; R-BTN-144, R-BTN-174, R-BTN-177).
  A credential inside the runner's sandbox is reachable by the agent whether or not the runner
  sets it in the leg's environment, so scoping it per leg is theater. Keeping provider keys out
  of the sandbox, behind a proxy, is the real mitigation, and it lies outside Baton. Rejected:
  passing credentials by canonical proof and by a choice's available alternatives, the rounds
  2–3 design.
- **`clingo-wasm` in `npm test` as the conformance oracle** (2026-10-22, owner; R-BTN-175). The
  owner would replace ASP-Core-2 only with "a different data log extension that addresses our
  needs with better TypeScript compatible tooling". Nemo, Soufflé, Logica and Mangle each bring a
  dialect that is not a standard, none can express the preferences, and none ships better
  TypeScript tooling. Their stratified-negation engines are in Rust, C++, Python or Go. No npm
  Datalog engine with stratified negation was found. `clingo-wasm` (Clingo compiled to
  WebAssembly, an ES module on npm) makes the oracle an ordinary test that contributors run.
  Rejected: a pip-installed clingo CI job, which brings Python into a TypeScript repository and
  an oracle nobody runs locally.

- **Leg logs in the owners' bucket, read with the reader's own credentials** (2026-10-21, owner;
  R-BTN-128, retiring R-BTN-118). Objects cannot be appended to, so a run is many create-only chunks
  and a reader follows it by polling for the next one, which works on S3, S3-compatible stores and
  GCS alike. The rejected alternatives: **the git transcript repository** chosen on 2026-10-17,
  because it grows without bound and cannot delete; **Baton-presigned URLs** (per object, tied to
  the claim) and **Baton-minted scoped credentials**, either of which would make Baton hold a bucket
  key, against keeping Baton free of content and of others' credentials; **long-lived
  service-account key files** on runners; **vendor append objects** (S3 Express One Zone, GCS
  appendable objects, Azure append blobs), each tied to one provider; **a multipart or resumable
  upload finished at leg end**, unreadable while the leg runs; and **keeping the relay through
  Baton for live viewing**, which the owner gave up along with web-app viewing for now.
- **Conditions bound dynamically to courses, over delivery policy in core** (2026-10-20, owner;
  R-BTN-160 to R-BTN-164). How a person is reached — which channel, how many tries, when to
  escalate, when to give up — is a project's, not Baton's, and differs between projects. The
  rejected alternatives: richer courier settings in core (a policy language Baton would own
  forever); a `decisions` ticket source that posts one delivery ticket per open decision (kept
  only for core's own conditions, which Baton cannot write to git for); and handler course ids
  written into each course (every repository with its own notifications would fork the standard
  courses). Common Lisp's condition system and BPMN's escalation events were adopted with their
  names, so readers have a precedent.
- **Bindings are git's, with no owner setting** (2026-10-20, owner; R-BTN-161). An
  instant-answer handler gives nothing push does not already give, since a person's answer is
  anyone's who can push (§10.7.5). The rejected alternative was an owner setting like check
  conclusions (R-BTN-114); those are owners' because a forge outside the repository trusts them,
  which is the line kept: special treatment only where something outside the repository trusts
  Baton's output.
- **A short wait in the claim, then a suspension** (2026-10-20, owner; R-BTN-162). A quick
  answer keeps the session's context, which matters when a leg is interrupted often; a long one
  holds nothing. Rejected: always suspending (a restart per question), and holding the claim for
  as long as a person takes (a runner slot idle for days).
- **Baton's clock decides a race; ties go to course order** (2026-10-20, owner; R-BTN-166).
  Rejected: workers' clocks (untrusted), and default-branch order (total, but brings git order
  into a settlement Baton must make before git shows it). An answer committed just before a
  deadline but synced after it loses; a course adds grace to `after_s`.
- **A withdrawn handler resumes with the default restart** (2026-10-20, owner; R-BTN-162).
  Rejected: leaving the leg blocked and listed, which helps no one when the person who could
  answer chose to withdraw the question.
- **No core expiry rule for questions** (2026-10-20, owner; R-BTN-166, R-BTN-169). An earlier
  draft gave a person's leg `answer_within`; a choice station's `after_s` says the same with no
  rule of its own, and expiry fails closed only as the raising course routes it — a course could
  route `unanswered` to "proceed", which is no new power, since the course is git's.
- **Parallelism stays in child tickets** (2026-10-20, owner; R-BTN-165, R-BTN-166). BPMN's tokens
  and its OR-join inside one process were rejected: several positions in one ticket would undo
  the one-holder lease, the fence and git-first records (R-BTN-4, R-BTN-86).
- **One amendment, not several** (2026-10-20, owner): conditions, calls, choices, timers and
  compensation change the course file and Baton's semantics together, and one change is cheaper
  for every course than five in a row.

- **Either kind of key, for people and workers alike** (2026-10-19, owner; R-BTN-159). SSH
  keys reveal nothing reusable on the wire, so a break-in or a captured request never lets
  anyone impersonate the holder later, but they cost the user `ssh-keygen`, an agent and a
  signing step; an API key is a shared secret, easy to hold and as easy to lose. The owner
  chose to let each holder trade one for the other rather than fix it per role. Superseded the
  same day's first ruling, "I only want to use ssh keys for runner authentication", which kept
  workers on signatures. Rejected: an Access service token as an administrator's key (it makes
  administration depend on Cloudflare, which §10.5 keeps optional, and a local Baton has no
  Access); keeping Access in front of `/v1/admin` and `/v1/owner` and adding a service token to
  the CLI (two secrets per user). Production bypasses Access on those paths, as on `/v1/sync`
  and `/v1/runner`, and keeps it on the dashboard.
- **Chose a Cloudflare Durable Object over SQLite on the owner's Raspberry Pi**
  (2026-10-13): cloud sessions cannot reach a home tailnet without exposing it, and a Pi is a
  single point of failure on home power and network.
- **Chose to move only the lease, not the lifecycle**: status, PRs, packets and ticket content
  stay in git, where PRs, reviewers, the reconciler and docs' process measurements already read them.
- **Chose the lease timeout as a worker property** over a per-claim duration (2026-10-13,
  owner): the worker knows how it fails, and every claim it holds fails the same way; clamped
  to 15 minutes – 24 hours.
- **Chose sidecar heartbeats plus fencing** over agent-thread heartbeats: long tool calls block
  the agent thread; fencing (R-BTN-6/7) is what makes reaping safe when a worker is alive but
  unreachable, partitioned or hung.
- **Chose a lease that lasts until done or a hand-off** over ending it at `in-review`
  (2026-10-13 review): the session still works the ticket through the review gate and the merge.
  *Superseded 2026-10-14 by the next entry.*
- **The ticket is a course of legs, and suspending it is the point** (2026-10-14,
  owner; §6.12): provider windows bind drafting and reviewing at different times, so an
  ticket must be able to wait at a step boundary until the line its next step needs has
  tokens, then resume. One session per ticket stays the norm. **Git and the PRs are the
  source of truth for leg progress as for the ticket** (owner): Baton replays them on
  every snapshot and is disregarded on a conflict.
- **Legs are stateless at their boundaries** (2026-10-14, owner): the PR branch,
  reviews and threads are each leg's input and output, so any session can run any
  leg; a session's context only saves re-reading. What git does not carry goes in a
  hand-off document on the primary PR (R-BTN-44), not a file on the branch, which would be
  reviewed and merged. **Rejected (same day):** a lease per leg with reviews run by
  seat-model workers and a 10-minute affinity — it optimised handing steps to *other*
  workers, which buys little when workers share accounts; and build/gate/land stages, too
  coarse for a review's own budget.
- **Baton advises on scheduling and gates only safety** (2026-10-14, owner; R-BTN-45):
  it does not know any provider's exact capacity at a given time, and a worker may know
  better, so recommendations are sorted advice and the worker decides. The lease, the
  ticket's readiness and holds, grants, its `requires` and tier, barred tags (for
  `roadmap-pr`, the owner's suspensions and reviewer independence), a hook's refusal, the
  course version and the retry backoff stay gates — each protects
  correctness or the owner's explicit say, not tokens. **Rejected:** Baton as the
  gatekeeper of capacity (the same day's earlier draft, rules 11–12 refusing).
- **Named the process a course and its steps legs** (2026-10-14, owner; §2a *Names*): the
  relay's own word for a segment that ends in a hand-off; *workflow* and *activity* were
  taken in this spec by GitHub Actions workflows and §6.9's activities. **Rejected:**
  track and lap — a lap is another trip round the same loop, not a distinct step — and
  any wider metaphor for workers, claims or tickets.
- **Baton serves many repositories and many courses, and knows no course's logic**
  (2026-10-14, owner; §2a): tickets live in registered repositories and name their course;
  each course is defined by its home repository's skills and replayed by its sync, and
  Baton generalises only leases, the course file's stations and legs, suspension and barred tags. **Rejected:** Baton interpreting `roadmap-pr` (an earlier draft vendored
  `locate` into Baton) — it would tie every new course to a Baton deploy.
- **SSH keypairs for machine identity** (2026-10-14, owner; R-BTN-13 as amended): Baton keeps
  only public keys, no reusable secret travels (RFC 9421 signatures with a nonce and a
  5-minute window), and private keys can live in hardware. *(Revised the same day after
  review:)* Ed25519, P-256 and their FIDO `sk-` forms, because the Mac's Secure Enclave holds
  only P-256; the signature an SSHSIG over the RFC 9421 base, so every ssh-agent and hardware
  key can make it, with a namespace and `@authority` covered, so a request signature can
  never stand in for another use of the key, nor a local Baton's request for
  production's. **Rejected:** keeping bearer
  tokens (a leaked token works for anyone until revoked) and per-session keys for now (a
  machine's sessions share its user and agent anyway; an SSH certificate per session stays
  possible).
- **One codebase, two hosts** (2026-10-14, owner; §3a): portable logic behind small
  interfaces, Cloudflare in production, a Node host for development and self-hosting, one
  Baton per repository. Production stays on Cloudflare. **Hooks run everywhere**
  (R-BTN-59): locally first planned in `workerd` inside a Firecracker microVM per repository, the sandbox
  the fleet already uses. *(Superseded the same day: local hooks are trusted and run in plain
  `workerd`, R-BTN-59.)* **Rejected:** turning hooks off locally (the owner wants no local
  limitation).
- **Keys in SQLite; administrators anchored in the deployment** (2026-10-14, owner; §10.6):
  administrators are SSH keys in the `BATON_ADMIN_KEYS` secret (or `--admin-keys` locally),
  because whoever controls the deployment already controls Baton; they register repositories
  and probes through a signed admin API, and each repository's owners grant worker keys for
  that repository only. Getting started is a deploy, one secret and a few CLI commands.
  **Rejected:** keys committed to git, even signed (ties identity to one repository's history
  and adds ceremony per machine); Cloudflare Access as the administrator's identity (an extra
  service to set up, and a second root of trust beside the account itself); writing the
  Durable Object's SQLite through Data Studio (no CLI, bypasses validation).
- **Provider capacity is course logic** (2026-10-14, owner; §2b, §7.3): providers, usage,
  forecasts, suspensions and model advice are `roadmap-pr`'s, computed in its hook from opaque
  inputs; core keeps leases, generic gates (now including tags, R-BTN-60) and passes data
  through. **Rejected:** core forecasts and model ranking (the earlier same-day draft).
- **Local hooks are trusted** *(superseded 2026-10-16: no hooks, R-BTN-98)* (2026-10-14, owner; R-BTN-59): a local Baton is for development
  and CI, so it runs hooks in plain `workerd` for interface parity, not isolation.
- **Even the gates are a protocol, backed by detection** (2026-10-14, owner; R-BTN-46):
  Baton cannot refuse a push, and GitHub cannot tell workers that share a token apart, so a lock binds only
  cooperating workers. The claim's nonce in each marker lets the sync notice two workers on
  one ticket; git still wins and the owner decides. **Rejected** (owner, 2026-10-14):
  Baton verifying signed commits and markers, a required `baton/lease` status check, and
  per-worker GitHub identities — each would have Baton replace or fortify git's security
  model, and whoever can push is a legitimate user (R-BTN-66).
- *(2026-10-14: the decisions on budget forecasts, exhaustion, provider suspensions and model
  advice moved with that logic to `BATON_ROADMAP_PR_COURSE`.)*
- **Chose ancestry over timestamps** for snapshot order: commit times come from each
  pusher's clock. *(2026-10-14: completion confirmation moved to observed legs, R-BTN-10,
  and what a sync saw is ordered by Baton's observation numbers, R-BTN-62 — never by a
  clock.)*
- **Chose GitHub OIDC for the sync** over a stored secret: agents can push workflows to
  branches, and a branch workflow cannot mint a `main`-bound token.
- **Chose one active claim per worker**, matching `next-roadmap-item`.
- **Chose activities over a free-text `stage`** (2026-10-13, owner): a typed, timed table is
  what a per-worker timeline needs. Skill-declared phases plus hook-observed actions, not one
  activity per tool call.
- **Chose transcript pointers reported by the archivers** over paths derived by convention:
  the opencode archiver is outside the repo and the Claude hook's convention has changed.
- **Git never records who holds a ticket** (2026-10-13, owner; R-BTN-36): the mirror keeps
  `in-progress` and the claim time for git readers, without the holder.
- **GitHub wins on every ticket fact** (2026-10-13, owner; R-BTN-35); Baton owns only the live
  lease. **Filter fields are a table, not a blob**: `tickets` and `ticket_requires`,
  so matching is one indexed query (§7.2); the per-snapshot JSON copy was dropped.
- **Filter fields in Baton, content in git** (2026-10-13, owner, made explicit): Baton keeps
  only what matching filters on (R-BTN-33); a worker fetches the ticket from git when its
  checkout lacks it (R-BTN-34).
- **Named the system Baton** (2026-10-13, owner). The host was first
  `workitems.immediately.run` (owner's choice of domain, the same day), the name and the
  hostname differing on purpose. **Moved to `baton.immediately.run`** (2026-10-14, owner)
  when "work item" gave way to "ticket": the old hostname named the roadmap's term.
- **The unit Baton hands out is a ticket** (2026-10-14, owner; §2a *Names*): "work item"
  was the docs roadmap's word and too generic for a product concept; each course says what
  a ticket is in its repository (for `roadmap-pr`, one roadmap item). **Rejected:** race
  (collides with race conditions in a lock spec), entry, relay, bib, task (Claude Code and
  opencode task tools), job (GitHub Actions jobs) and item.
- **Integration scenarios are part of every Baton roadmap item** (2026-10-13, owner): the failure modes
  that matter — timeouts, retries, poisoned tickets, reaps, disabled providers — are
  interactions, which only a driven, fake-clock suite can prove (R-BTN-29–31).
- **Adopted three ideas from Temporal** (2026-10-13, owner): a retry policy with backoff, a
  bounded attempt count and non-retryable failure classes (§6.10); worker versioning by a
  skills version (R-BTN-22); and recorded activity results as a resume record, with
  idempotent side effects (§6.11). **Not adopted:** deterministic replay (a skill read by an
  LLM cannot be replayed — the resume record is the useful part), and running Temporal
  itself (only its task-queue layer would be used; the Durable Object is that layer).
- **One file per Claude session, named by its start day** (2026-10-13, owner): midnight must
  not split a session's transcript.
- **Rejected a `settled` claim status** (2026-10-13, owner): `confirmed_at` carries it.
- **Rejected expedite as a message** (2026-10-13, owner): it is a property of the ticket.
- **Rejected releasing a dead worker's claim by message** (2026-10-13, owner): the owner reaps.
- **Rejected a git fallback** (R-BTN-18): two lock servers allow two holders.
- **Rejected provider availability as a matching filter in v1**: the session's model is fixed
  when it starts. *(2026-10-14: still not a filter — availability is now advice, R-BTN-45 —
  and the premise is to be re-checked by the R3-1210 spike, R-BTN-49.)*
- **Baton acts only on its own vocabulary; courses post data** (2026-10-14, owner;
  R-BTN-50): anything that needs to know what a leg means is course code in the
  home repository; Baton evaluates generic predicates — readiness, edges, run limits, barred tags —
  over what the course posts *(work-in-progress bounds, once listed here, left core the same
  day: they are the course's hook's advice, R-BTN-41; a leg's queue bound returned 2026-10-15 as
  a course-file property core counts, advice only, R-BTN-79)*, and a boundary test keeps it that
  way. Already-built roadmap knowledge in
  Baton (rule 8's matrix, the `review-capacity` hold, fixed step kinds) moves out in its
  own item, after cutover if need be, since moving it changes no behaviour.
- **Hooks run in Baton, sandboxed; probes run outside it, with the secrets** *(superseded
  2026-10-16 for hooks by "Baton runs no repository code" below)* (2026-10-14,
  owner; §2c): request-time course logic is repository JavaScript in a Dynamic Worker
  with no network or bindings, whose output can only narrow and order what the gates allow
  and carry advice; provider knowledge that
  needs keys comes from probes (the Pi) that post readings Baton stores unread. The trust
  model is the one GitHub Actions and git hooks use, stated in R-BTN-54: writing to a
  registered repository's default branch means running code in its hook sandbox.
  **Rejected:** a probe's recommendation passed straight to workers (it cannot see claims
  made since its reading, so it would overbook a line); scraping a logged-in web console.
- **Revisions after the 2026-10-14 adversarial review** (Review record):
  - **A claim is stale only when git takes the ticket away or its leg back to `not-yet`**
    (R-BTN-35): a leg turning `done` or `waiting` is the holder's own progress. **Rejected:**
    "stale when the leg is no longer `ready`", which released every claim at its first push.
    *(Superseded the same day: since the fifth review a claim is ended stale only when the
    ticket is taken away, and a path that goes backwards is flagged, not acted on — §2e,
    R-BTN-35.)*
  - **Gates are re-checked after the hook, in one transaction** *(moot 2026-10-16: no hook call,
    so the whole decision is one transaction, R-BTN-98)* (R-BTN-52): a Durable Object
    serialises only between awaits, and a hook call is one. **Rejected:** holding the object
    for the hook's duration (not possible on Cloudflare) and calling hooks only from the
    alarm (stale advice at every request).
  - **Repositories merge by weight, courses by place in their own order** (R-BTN-61): scores
    from different hooks are not comparable. **Rejected:** normalising scores across hooks.
  - **Grants carry capabilities, per repository** (R-BTN-58); `human-operator` is the
    administrator's; hostnames are unique. **Rejected:** capabilities on the global key,
    which let one repository's owner set them for every repository.
  - **The administrator key is separate and out of agents' reach** (R-BTN-57).
  - **The skills version is each course's version** (R-BTN-22), and the reference repository
    is gone (§2a): nothing fleet-wide was left for it to post.
  - **One GitHub App dispatches every repository's workflows** (§10.3) rather than a token
    per repository.
  - **The roadmap-pr course's provider logic is its own spec**
    (`BATON_ROADMAP_PR_COURSE`), and its reviewer independence bars the seats from
    writing rather than the author from reviewing. **Kept, though the reviewer suggested
    cutting them:** `launch-advice` (the one place a launcher can ask which model to start
    on) and repository `weight` (one integer, needed the day a second repository arrives).
- **Stations, legs and the course file** (2026-10-14, owner; §2e): a ticket rests at a
  **station** and a **leg** takes it to the next; each course's whole state machine is one
  file, `course.json`, a closed set of stations and legs that Baton validates (reachable,
  able to finish, loops bounded) but never interprets. Within a claim Baton checks only that
  an `advance` is an edge, under its run limit, with the gates holding, and takes the
  holder's word for which edge git supports; syncs confirm ends, Baton ends a claim stale only when the
  ticket is taken away, and a path that goes backwards is flagged for the holder. **Rejected:** every leg instance pre-posted with positions (it cannot express loops
  such as review → fix → review), per-advance vouches confirmed by later syncs (the source of
  most defects in three review rounds), guards in the file (they would make it a workflow
  language; conditions stay git facts the sync evaluates), YAML (parser surprises; a course
  may still write YAML and have its sync convert it), and "state", "stage", "checkpoint" or
  "milestone" for the station.
- **A runner and per-leg scripts** (2026-10-14, owner; R-BTN-72): `baton run` asks Baton for
  the next leg and runs that leg's script, `legs/<leg>.mjs`, loaded per claim from the
  snapshot so course changes need no worker restart; the course file decides which legs may
  follow, and a leg names the next only where the graph branches. **Rejected (same day,
  owner):** one per-course worker module — the graph is the course-level logic, so a module
  above the legs adds nothing. Interactive sessions keep working through the same API.
- **External resources: instruments report, Baton records; per Baton, by instance**
  (2026-10-15, owner; R-BTN-76): a worker or a probe that can see a provider, an API or a disk
  posts a reading — an envelope core reads, a `detail` checked against the resource's schema —
  and every reading lapses. **Rejected:** Baton running the checks itself (they need the
  network, which the hook sandbox does not have, and the workers' own credentials — a GitHub
  limit is per token or IP, a provider's per account); readings scoped to a repository (they
  come from keys, and one account serves every repository); a failed check blocking forever
  (lapsed readings are `unknown` and fail open).
- **Human decisions are a block of their own** (2026-10-15, owner; R-BTN-78), not an external
  resource: they do not lapse, must not fail open, and no worker knows better.
- **Blocks are stored rows with an index, and unblocking is an event** (2026-10-15, owner;
  R-BTN-75–77): "is it blocked, and on what" and "what is blocked on this" are each one index
  read, so dashboards, runners and agents can ask freely. **Rejected:** computing blocks on
  each read (a pass over the board and the fleet per question); resource blocks as a gate (a
  worker's own key may be fine — advice, R-BTN-45); a hook export run on unblocking (hooks do
  no I/O; the repository's workflow does what it needs); re-deriving dependencies from
  `depends_on` and Baton's closures (review gate round 1: it disagreed with the course's own
  rules for superseded and archived tickets — the posted `blocked_by` is the course's answer).
- **A leg's queue bound is a warning** (2026-10-15, owner; R-BTN-79): a ticket always enters
  its queued leg's queue, and a queue over its `max_queue` raises a `queue-over` notice.
  **Rejected:** a refusing bound (git is anyone's, advice never refuses, a bounded loop could
  deadlock); advisory `queue` blocks on the legs feeding a full station (the first draft, in
  review rounds 4–6); admission blocks holding a ticket outside a full queue — a second, hidden
  queue no one counts. A course with a leg over its bound **closes its intake** — new tickets
  are not recommended while the ones in flight drain — as advice; **rejected:** a refusing
  intake gate (throughput is not safety, and git starts tickets regardless).
- **Leg completion names a position, and Baton keeps pointers, not content** (2026-10-15, owner;
  R-BTN-81–84, R-BTN-33 amended): a leg names the station it reached and the leg it queues,
  written to git first; Baton keeps a running history and the URIs and digests of each leg's
  inputs and outputs, so legs can be type-checked and replayed. **Rejected:** inferring the
  next leg from a station with one leg out (a later course change makes it ambiguous); naming
  only the next leg (edges join nodes; the outcome is a station); storing inputs and outputs
  (R-BTN-33); an event-sourced, replayable log (course code is not deterministic and git is
  the truth); Baton validating content (it never fetches — the worker does, and fails the leg).
- **Every disagreement with git is logged before git wins** (2026-10-15, owner; R-BTN-85): a
  discrepancy row with both values, so it can be reviewed later. **Rejected:** holding git's
  version until reviewed (git is the truth, and Baton is a cache).
- **Tickets are sequential; child tickets are the parallelism primitive** (2026-10-15, owner;
  R-BTN-86). **Rejected:** concurrent legs within one ticket (sets of positions, per-leg leases,
  a new core invariant and formal model).
- **One Baton per team, not sharded** (2026-10-15, owner; R-BTN-87): a stated, load-tested
  envelope; beyond it, another Baton. **Rejected:** sharding one Baton by repository.
- **Owner state is exported, not mirrored to git** (2026-10-15, owner; R-BTN-88): owner limits
  live in SQLite so no commit can change them, and an export restores them. **Rejected:**
  writing owner state to a git repository (agents could then change it).
- **The function that places a ticket is `locate`** (2026-10-15, owner): it was `legsOf`, which
  undersold what it returns — station, path, queued leg and next legs.
- **Requests for people leave Baton through couriers** (2026-10-15, owner; R-BTN-80): Baton
  queues a notice per courier; a courier claims, delivers and marks it sent — the instrument
  pattern in reverse. **Rejected:** Baton sending mail or push itself (credentials and I/O in
  core, one channel per operator); one shared notice per decision (the first courier to claim
  would hide it from every other channel); answering through Baton (git holds the answer, by the
  decision's own protocol).
- **Ticket sources and courses are per repository, with defaults in the CLI** (2026-10-14,
  owner; R-BTN-74): a markdown ticket source and a `pr` course let a repository start with
  no code of its own, and either is replaced by adding one file. **Rejected:** a ticket
  format built into core (it would put a repository's conventions in Baton) and no default
  at all (every repository would write a sync before its first ticket).
- **Webhooks trigger syncs** (2026-10-14, owner; R-BTN-73): GitHub App events from every
  installed repository dispatch the sync, so stations refresh within about a minute; the
  Action still computes them from git. **Rejected:** building stations in Baton from webhook
  payloads. *(After the sixth review, owner-approved:)* Baton reads exactly the payload
  fields that drop its own feedback (`workflow_run.path`, a push's `pusher.name` and
  `head_commit.author.email`) besides the repository, and sends one trailing dispatch after
  a suppressed burst. **Rejected:** reading nothing and living with the feedback loop (the
  fifth review's B4), and `check_suite` deliveries, which add a permission for what
  `workflow_run` and the schedule already cover.
- **Bars are per course** (2026-10-14, owner-approved after the sixth review; R-BTN-67): an
  owner or required bar names a course or `*`, so a rule meant for `roadmap-pr` never bars
  another course's legs of the same name. **Rejected:** per-repository bars (the fifth
  revision).
- **A checked model of the core** (2026-10-14, owner; R-BTN-68): a Quint model, model-checked
  before merge and checked against every scenario's trace, before cutover. *(Amended
  2026-10-17, owner: checked on the author's machine, not in CI — R-BTN-68.)*
- **Revisions after the second review, and for courses that change without Baton**
  (2026-10-14, owner direction; §2d):
  - **Trust the holder's evidence** (owner). *(Superseded the same day by the course file,
    below: the per-advance vouches and their confirmation are gone.)*
  - **Observations are numbered by Baton** (R-BTN-62), and confirmation reads observed legs
    (R-BTN-10): commits order the home repository, nothing orders what a sync saw in PRs.
  - **Usage stays with the repository it was posted to** (owner: the Pi's readings are for
    docs' `roadmap-pr` only; another repository is a separate post). **Rejected:** a
    fleet-wide usage view across repositories.
  - **A minimal core so courses can evolve, by agents too** (owner): work-in-progress
    bounds, retry constants, tiers, the resume record's content and every docs function
    leave core; a course has a `min_worker_version` beside its `version`, a test kit, its
    own stats and a hook interface that grows. **Rejected:** core-defined course
    vocabularies of any kind.
  - **Agents can change anything in git; what they must not change lives in SQLite**
    (owner, R-BTN-66): owner bars and required bars (R-BTN-67), the tier ladder, the retry
    policy and the transcript repositories are Baton settings set by owners' and
    administrators' keys. **Rejected:** an owner-only policy file in git, and treating a
    reviewed PR on `.baton/**` as a protection — an agent can write the PR and run the review.
  - **Baton does not fortify git's security model** (owner, R-BTN-66): whoever can push is a
    legitimate user; Baton checks no commit or marker signature, and relies on no branch or
    path rule. **Rejected:** foreign-write attribution by SSH-signed commits (an earlier
    revision) and Baton reading GitHub itself to verify them.
  - **Dropped:** `required_tags` (a machine runs several models) and the "reference
    repository"; owner keys join administrator keys outside agents' reach.

- **Chose time as git data, not Baton's schedule** (2026-10-15, owner: recurring jobs as
  courses): a queued leg's `not_before` is written to git by the ticket file or the closing
  marker, and Baton only compares it with its clock; schedules (cron and time zone) stay in leg
  scripts. Recurring jobs are a series of child tickets, each run writing the next
  (R-BTN-89). *(Rejected: a looping timed leg, which grows the path for ever; a worker-less
  wait leg Baton completes, which moves a ticket without git.)*
- **Chose a course-set leg deadline enforced by release and fence** (2026-10-15, owner): Baton
  cannot stop a worker, so it takes the claim away; a timeout is a failed attempt (R-BTN-90).
- **Chose pulled syncs over dispatch, and sync keys over CI identity alone** (2026-10-16, owner:
  Baton should run as well on GitLab, Gitea or a plain git server as on GitHub): Baton records
  that a sync is wanted and any runner — a cron loop, a CI schedule, a `post-receive` hook —
  asks for it with one signed request, so Baton needs no forge credential to make a sync
  happen; dispatch survives as an optional push per forge (R-BTN-94). A sync key works on every
  forge and on none, where OIDC exists only on GitHub and GitLab (R-BTN-93). *(Rejected:
  client-side `pre-commit`/`post-commit` hooks — they fire before anything is shared and would
  put the sync's credential within agents' reach (§2k); a long-lived bearer token per
  repository — R-BTN-13 withdrew bearer tokens.)*
- **Chose a WebSocket doorbell over server-sent events and over push delivery** (2026-10-15,
  owner: only if it suits Cloudflare): hibernating sockets cost nothing idle; a ring only
  shortens the wait for the heartbeat, which stays the one delivery and fence path (R-BTN-91).

- **Baton runs no repository code; workers rank** (2026-10-16, owner; §2l, R-BTN-98): request-time
  course logic runs on the worker, from a fleet and an instance view Baton serves, and may call
  an LLM or any service the worker can reach. A strict sandbox kept hooks from anything
  interesting while still exposing an attack surface, and everything else that acts —
  claimants, instruments, couriers — already ran outside Baton. It also removes the
  three-phase claim, the recommendation cache, `hook-failed` and the local hook runtime.
  **Rejected:** hooks as a service the repository hosts and Baton calls (Baton calling
  arbitrary URLs — reach, latency and availability it would own); a looser sandbox with
  network access. **Cost accepted:** workers may rank by different versions of the code, and
  a stale or self-serving one can take a leg another would have left; all of it is advice.
- **Peers see each other; shared accounts are per Baton** (2026-10-16, owner; R-BTN-99,
  R-BTN-101): every worker granted on a repository reads its peers' claims, profiles and
  reports, and every account's readings and billings are shared across repositories, with a
  ticket shown only to keys granted on its repository.
- **Measurements, not forecasts, are shared** (2026-10-16, owner; R-BTN-100, R-BTN-101): Baton
  keeps every instrument's reading and counts the claims billing each account; estimates stay
  in the worker's ranking code. **Rejected:** forecast by reservation and `factory_share`
  (`BATON_ROADMAP_PR_COURSE` §4 as first written) — estimates vary 55× for `implement`,
  cannot be checked, and agents would learn to report low ones; a per-instance spend ledger
  with estimates. **Cost accepted:** advice no longer stops sending work to an account once the
  work already started there is forecast to fill it; the billing count and the readings catch
  most of that, and the provider's limit is the truth.
- **A self-loosening post is noticed, not stopped** (2026-10-16, owner; R-BTN-102): an agent that
  loosens a ticket's gates with its own board post and then claims it is listed under **Needs
  you**, not refused. "If we see rampant abuse in the future we can address it then."
  **Rejected for now:** refusing a claim or a settlement whose looser gates came only from the
  claimant's own key's post.
- **Repository weight does not arbitrate shared capacity** (2026-10-16, owner): Baton is advice
  among parties that trust each other, so first come takes an account's room; fairness logic
  can come later. `weight` still orders one worker's merged list (R-BTN-61).
- **A machine key is trusted with everything a machine does** (2026-10-16, owner; R-BTN-102):
  work, sync, readings, delivery — none required. It reverses "one role per key" for machine
  keys only. **Cost accepted, stated in R-BTN-102:** any agent on a granted machine can post a
  board matching no commit; posts record their credential, the harmful ones are listed under
  **Needs you**, and owners may turn `machine_sync` off. **Kept:** owner and administrator keys
  never machine keys (R-BTN-57, R-BTN-66); the mirror stays with sync keys and CI tokens (one
  writer of its cursor). *(Revised after the 2026-10-16 reviews: the first draft said this added
  no trust, and let machine keys mirror and report on any instance.)*
- **Worker couriers deliver from a pool** (2026-10-16; R-BTN-103), personal channels each keep
  their own copy, which is what guarantees a person hears; confirmed by the owner the same day.
  **Rejected:** a copy per worker courier — every notice once per worker.
- **Open world for unknown tickets, at entry legs** (2026-10-16, owner; R-BTN-104): a lagging
  view must not stop work git allows. Settled only by a post containing the claim's commit, and
  ended when an author's gate fails, as R-BTN-5 would release it *(revised after the 2026-10-16
  reviews: the draft logged a failed gate and kept the claim, and settled on any later post)*. **Rejected:** open world for known tickets with stale
  state (§6.7's reclaim protection reads Baton's own records, and the worker can sync, then
  claim); open world at any leg (required bars are enforced against posted bars).
- **A plain git server is passive** (2026-10-16, owner; R-BTN-105): workers sync, so no
  `post-receive` hook, spool or sync key is required on the server. **Kept:** the server's own
  `receive.deny*` settings and `git-shell`, which are git's, not Baton's.
- **The course file travels with every sync** (2026-10-16, owner; R-BTN-69, R-BTN-105): read from
  the commit the post names, never a working tree. **Rejected:** a hash with the body only on
  change — a few KB per course is not worth the second path.

- **The runner organizes legs; a session reports to it, never to Baton** (2026-10-17, owner;
  R-BTN-106): the session needs no claim credential, and every move is checked once, where the
  claim lives. A bounded run is the runner's own discipline; `no_chain_from` is a gate, because
  independence is owed to the owner, not chosen by the worker.
- **Cloud sessions as runners, two modes** (2026-10-17, owner; R-BTN-107): `attached` is cheap
  and its isolation advisory, said so and shown; `session` keeps the claim out of every agent
  session. Rejected: giving a child session a scoped claim token — a credential in the child is
  what `session` mode exists to avoid.
- **One envelope, named schemas, refinement checked both ways** (2026-10-17, owner; R-BTN-108):
  validating against the base as well as the refinement is the guarantee a base's consumer
  needs; the static refinement check is sound but conservative. Rejected: full JSON Schema
  (`anyOf`, `oneOf`, conditionals) — refinement becomes undecidable in practice and validation
  unbounded.
- **Entry requirements on stations, not legs** (2026-10-17, owner; R-BTN-109): what must hold
  on arrival is the station's meaning, whichever leg arrives. Baton checks presence and inline
  values; the sync checks pointers, so Baton still never fetches.
- **Standard formats are a library, not core** (2026-10-17, owner; R-BTN-110, R-BTN-50): core
  stays course-agnostic; a `std:` id is a string to it.
- **Views are data; Baton renders** (2026-10-17, owner; R-BTN-112): a course shipping rendering
  code would be repository code running in Baton or in every viewer (R-BTN-98).
- **Checks run as courses; the merge check is delivered by a forge courier and signed by Baton**
  (2026-10-17, owner; R-BTN-114, R-BTN-115): Baton holds no credential of the check App; the
  signature and the read-back make a check Baton never issued visible; branch protection pinned
  to a dedicated check App makes a status context, or Baton's own App, insufficient. Who may
  report a check is a key role the owners register, and its conclusions are an owner setting,
  so the key that wrote a change never reports its check (review gate round 1, baton#43).
  Rejected: the worker courier pool for checks — any worker could then withhold or post its own
  change's check; check tickets claimable by work keys — the same, one step earlier.
- **A leg never waits on a delivery** (2026-10-17; R-BTN-116): "sent" is a courier's word; a leg
  waits on an effect git or the forge shows.
- **API keys beside SSH keys** (2026-10-17, owner: "requiring ssh for runner auth is not great,
  users should be able to fall back to regular api keys"; R-BTN-117): reverses the 2026-10-14
  choice of signatures only, for workers and personal couriers, with the cost stated in the rule;
  owner, administrator, sync, instrument and forge-courier keys stay signed.
- **A leg's output streams over TLS and is never stored** (2026-10-17, owner: "we don't need
  hand-rolled encryption for streaming logs if we use standard wss://"; R-BTN-118): Baton sees
  the frames as it relays them, so R-BTN-33 is amended to relaying, not storing. Rejected:
  end-to-end encryption to the viewer — more machinery than a stream nobody stores needs. Each
  stream has its own object, so the doorbell stays a ring.
- **A leg's prerequisites in one place, answered in one call** (2026-10-17, owner; R-BTN-120):
  the five kinds existed under five names and two scopes; they are now one `requires` per leg,
  stored as the blocks they already were, and `baton why` answers every one. Another ticket may
  be required `at` a station (where it is now) or to have `reached` one (owner: both). Rejected:
  a separate decision field — a person's answer the next leg needs is a person's leg and an
  entry requirement (R-BTN-116, R-BTN-109).
- **Capability types belong to the course file** (2026-10-17, owner; R-BTN-121): a VPN, a
  database, a credential or an authenticated harness is what a course's legs need, so the
  course declares the type and its value pattern, and the runner checks what it declares.
  Chose each course file over the repository's `baton.json` (owner); two courses may define one
  type differently, and the dashboard shows it. Rejected: keeping `ROLES` in docs' vendored
  library — core would keep one deployment's vocabulary.
- **One registry of actions; Baton serves MCP** (2026-10-17, owner; R-BTN-129, R-BTN-130):
  the REST API, the CLI, the dashboard and MCP are surfaces of one list, checked by one
  function. The owner chose today's roles and scopes over named permissions, a remote MCP
  endpoint over a local `baton mcp`, and every route in the registry. What MCP may reach is a
  closed allowlist, reads and three narrow writes (review gate round 1), because an open rule let
  a key add owners or loosen limits. Rejected: a local stdio
  server only, which hosted agents cannot reach; giving MCP the owner's own key, which would
  put a person's key in an agent's hands. An MCP key is a narrowed, expiring owner grant
  instead.
- **The CLI is a tree of nouns and verbs; a leg run's output is saved to git** (2026-10-17,
  owner; R-BTN-127, R-BTN-128): `baton leg log` and every other leg command under `baton leg`,
  as `git remote …` groups a remote's. The owner chose to save each run's output now, in the
  repository's transcript repos and never in Baton, and to rename the old commands outright.
  Saving is opt-in per repository (`leg_logs: true`; review gate round 1), because it widens who
  can read a leg's output to the transcript repository's readers. Rejected: aliases for the old
  names (owner: nothing has shipped widely, so the break is cheap); verb-first commands (`baton log <ticket> <leg>`), which scatter one object's
  operations across the top level; storing logs in Baton, which R-BTN-33 forbids and which
  would make Baton hold content.
- **A prerequisite that fails during a leg blocks the leg's edge** (2026-10-17, owner; R-BTN-126):
  "not a new station in the course graph … simply a colored edge". A blocked end spends no
  attempt but is bounded by the owners' `max_blocked` (a legacy end is exempt only when the
  worker's own unavailable reading already lowers the leg for it), and an error that names a prerequisite
  is never retried; a resource that fails for one worker blocks the edge for the fleet only
  when no other worker has a usable instance (review gate round 1). Rejected: a `blocked`
  station in each course — a course would need one per leg, and the ticket's station must be
  where its work is; treating capacity as a retryable error — it spends attempts on something
  no attempt can fix; waiting in the claim — it holds a lease another leg could use (§6.12).
- **Retries per leg, typed by the course, bounded by the owners** (2026-10-17, owner; R-BTN-122):
  Temporal's retry policy, error types and timeouts apply to legs as to activities. A backoff
  is a prerequisite (owner), so a leg waiting for its next attempt is never offered and `baton
  why` says so. Courses declare and type their errors; owners hold the default, the ceiling
  and the floor, because a course file is in git. Rejected: retry policies only per
  repository (today's) — one failing leg spent every leg's attempts; letting the course's
  policy override the owners' — an agent could raise `max_attempts` without bound.
- **A fresh context under the same claim; a planning course instead of a coordinator; urgent
  decisions** (2026-10-17, owner; R-BTN-123 to R-BTN-125), each taken from Gas Town where it fits
  Baton's model: the runner refreshes a session whose context is filling, as Gas Town's Witness
  does, without losing the lease; planning is a course the CLI ships *(a course directory since 2026-10-19, §2p: the CLI ships none)*, not an agent in core;
  severity routes and orders decisions. **Not built:** asking a predecessor session — a course
  leg's feature, to build when a course needs it, on top of the worker saving a leg's session
  (owner). Rejected from Gas Town: a merge queue (the forge's), steps inside a leg (the station
  is Baton's unit of durability), federation (one Baton per team) and agents supervising agents
  (Baton's alarm, leases and fencing).
- **Stopping a leg is the runner's, asked through Cancel** (2026-10-17, owner; R-BTN-119): the
  existing release path is authenticated and logged; a viewer's stream never controls.
- **One tenant per Baton, named by its origin; many tenants later as a router** (2026-10-18,
  owner; R-BTN-135 to R-BTN-138): build for one tenant now so a deployment can later serve
  parties who do not trust each other with no interface changed and no trust promise taken
  back. The origin already binds every credential, so a tenant needs no id on the wire, and
  the router later maps a host to a tenant's object, each a Baton as this spec describes.
  Rejected: a tenant id in every path or a signed header (it changes every route and
  signature now, for nothing the origin does not already give); one shared object with a
  `tenant_id` column (one tenant's load stalls the rest, and every query must remember the
  filter); routing signed requests by a global key directory (a public key is public, so
  global uniqueness lets one tenant squat another's key and reveals where a key is
  registered, P7); sharing provider accounts or scheduling across tenants (federation,
  rejected 2026-10-17). Accepted cost: Baton cannot see a key granted in two tenants; the
  runner refuses one, and the rule is one machine key per tenant.
- **Hardening within a tenant** (2026-10-18, owner, after the security review; R-BTN-139 to
  R-BTN-158). R-BTN-66 stands: whoever can push is a legitimate user, and Baton fortifies
  nothing in git. What changed is that people **without** push, a board post, and one
  repository's key gain nothing more.
  - **Owner decisions, 2026-10-18:**
    - a key granted on several repositories syncs and delivers only where each grant opts in
      — option (a) of three, over refusing outright and over visibility only;
    - a check's verdict is a command's exit status, over keeping the model's verdict with the
      injection risk stated;
    - MCP writes are a hold that only adds and `leg.stop`, over keeping expedite set-only;
    - the local host binds loopback by default, `--bind` overrides it, and TLS is the
      operator's (an nginx proxy, Tailscale serve);
    - on GitLab, Developer (30) can push, over Maintainer (40).
  - **Kept, not relitigated:**
    - 2026-10-16's self-loosening post stays noticed, not stopped: R-BTN-147 and R-BTN-148
      refuse nothing it kept open.
    - The course file still travels with every sync. Refusing machine-key course-file changes
      was rejected, since on a plain server machine keys are the only sync. Loosening is
      listed instead.
    - R-BTN-101's 31-day `measure` stays, since monthly spend needs it. An administrator's
      clear is the remedy.
    - `replay_safe` keeps its default; replay's environment allowlist makes it safe.
  - **Rejected:**
    - signatures on markers or commits, again (R-BTN-46);
    - a per-worker forge identity;
    - Baton fetching git to check ancestry — the runner checks it, and Baton only notices.
- **One primitive per kind of prerequisite** (2026-10-19, owner; R-BTN-132). R-BTN-86's
  whole-parent fan-in was right when it was written (review gate round 1): a ticket block was
  whole-ticket and nothing could bind one leg. R-BTN-120 made per-leg ticket rows, and kept
  `blocked_by` only so no source had to move at once. Kept: the source's authority over which
  dependencies are open (R-BTN-75), now expressed by which `depends_at` entries it posts.
  Rejected: renaming the ticket's `requires` to `capabilities` (a wire rename for every source,
  for a name each reader already sees beside its owner); dropping `waiting_on` (the forge
  effects `review-pr` and CI wait on have no kind, and should not get one in core); translating
  `depends_on` to every leg (it would change in-flight tickets' behaviour, which have only ever
  waited at the start).
- **A leg runs in a worktree at its commit, with Node's resolution** (2026-10-19, owner, §2o,
  R-BTN-133) over: **bundling each leg with esbuild at claim time** — a compiler inside the
  runner, a second resolver whose answers can differ from Node's, and a published CLI that
  needs esbuild at run time; **running legs in the home checkout's working tree** — it may be
  on a feature branch or carry uncommitted edits, which R-BTN-34 and B-33 rule out;
  **scratch files with `NODE_PATH` or a symlinked `node_modules`** — ES module resolution
  ignores `NODE_PATH`, and the home checkout's `node_modules` reflects its working tree, not
  the commit; **a loader such as `tsx`** — a runtime dependency for what Node 22.18 does
  natively; **`--ignore-scripts`** — the commit is already trusted with the worker's rights,
  and native modules need their scripts; **a new tree per claim** — an install per claim,
  where reuse by commit costs one per commit. *(Round 2 on PR 57:)* **installing from the
  repository root** (owner, 2026-10-19: no) — the home tree's commit moves with every push, so a
  site or monorepo would pay a full install per claim and per sync; only the course directory
  and `.baton/` are install roots, cached by lockfile digest; **pnpm and Yarn** — Yarn's
  Plug'n'Play leaves nothing for Node to resolve and pnpm's hard links defeat the read-only
  bits, while npm ships with Node; **raising `min_worker_version` to keep older runners off** —
  rule 9 compares the course version a worker reads from its own checkout, which an older runner
  has once it pulls, so the gate is a built-in `runner:` capability; **trusting a commit Baton
  was posted** — Baton checks a post's parent, not its ancestry, so the runner checks ancestry
  itself on every claim.
- **The tree is read-only after its install** (2026-10-19, §2o): trees are shared by every claim
  at a commit, so a writable tree would let one leg change what a later one runs. Advisory, as
  R-BTN-106's isolation is, and said so.
- **A course is what its source names, and the CLI ships none** (2026-10-19, owner, §2p,
  R-BTN-134) over: **the CLI's registry, with sources held to the CLI's own commit** (B-33) — a
  published CLI is no git checkout and cannot tell its commit, and a course fix needed a CLI
  release; **a stored `@main` or tag** — a name would stop meaning one graph (B-33's reason
  stands; `--source` and init resolve a ref to a commit before writing); **copying the source's
  files into `.baton/` and checking them byte-equal** — two copies of one truth, and a CLI that
  must hold the original to compare; **trusting any fetchable commit** — GitHub serves a fork's
  commits through the parent's URL, hence the reachability check; **keeping `--eject stations`**
  — it was already refused for every sourced course, and owning a course is a copy.
  *(Round 2 on PR 57:)* **sandboxing a source's `sync.mjs`** (a child without the OIDC
  variables, sources installed with `--ignore-scripts`) — the owner chose, 2026-10-19, to trust
  the pin and state its reach plainly, as a pinned action's: a source runs with the sync job's
  full environment, `id-token: write` included; **fetching a commit by its id** — forges differ
  on allowing it, and on GitHub a fork's commit answers; a blobless fetch of the default branch
  is checked instead; **copying `entry.json`'s fields into the home** — they would go stale when
  the source moves, so they are merged at read time; **course directories that import their
  repository** — a sparse tree could not run them and owning a course would not be a copy, so
  shared code is copied in by the source repository's own script.

## Review record

*(2026-10-14 — the amendment at `295ca61b` was reviewed adversarially by a fresh agent:
NOT READY, with 4 blocking, 13 major and 2 minor findings, open decisions and suggested
cuts. Resolved in the revision that follows it:)*

| Finding | Resolution |
|---|---|
| B1 the author-family bar on review legs stops one session finishing a ticket | bars by the claimant only; `roadmap-pr` bars seats' families from `fix`/`merge`; a review with no runnable seats is `waiting` (R-BTN-60; course spec §6; G-BTN-48, -59; S-BTN-17, -33) |
| B2 "stale when not ready" releases claims at their own pushes | stale only on a taken-away ticket or a `not-yet` leg (R-BTN-35; G-BTN-59; S-BTN-34) |
| B3 hook awaits break serialisation | three phases, gates re-checked in one transaction after the hook; both hosts interleave alike (§3, R-BTN-52, R-BTN-55; G-BTN-60; S-BTN-35) |
| B4 cross-repository merge undefined; limit before weight; no rank when suspended | R-BTN-61; per-group limit; every ticket with a ready leg ranked (§7.1, §7.2; G-BTN-61; S-BTN-26) |
| M5 tags self-reported | said so; grants may require tags (R-BTN-60, R-BTN-58) |
| M6 the gate's inputs are agent-pushable | path rule widened to `.baton/**`; the residual risk of imported board code stated (§10.3) |
| M7 owners escalate through global credentials | capabilities per grant, `human-operator` administrator-only, unique hostnames, `conflict` (R-BTN-58, R-BTN-13; S-BTN-32) |
| M8 administrator key in agents' ssh-agent | separate, touch-required key, refused in any other role (R-BTN-57) |
| M9 Ed25519 cannot live in the Secure Enclave | P-256 and `sk-` keys (R-BTN-13, §6.4) |
| M10 incomplete signature profile | `@authority`, empty-body digest, fingerprint `keyid`, SSHSIG namespaces (R-BTN-13; S-BTN-30) |
| M11 three board payloads | one normative board post (§7.1); `.baton/**` in the triggers |
| M12 schema vs prose | `course_json`, per-repository `held_snapshots` and events, event kinds, `hold_reason`, step kinds, `leg_key`, comments, actors, login links and sessions (§4) |
| M13 rule numbers with old meanings | renumbered references; `qualifyingPair` is docs code (§7.2, course spec §6) |
| M14 superseded text | frontmatter, §2, §2a, §6.12, §10.2, §13a, §15, Decisions, Open questions cleaned; §7.3 moved |
| M15 hook refusals bypassed by naming a ticket; the impossible push-to-sync refusal | hooks run on every claim (§2c, §6.2); scheduled suspensions instead (course spec R-BTN-21) |
| M16 multi-repository branch names, dispatch and skills version | `branch_pattern` and the branch-holder query (§6.3); a GitHub App (§10.3); course version (R-BTN-22) |
| M17 the live view crosses repositories | hook input scoped to its repository; probes bound to repositories; `reasons`/`advice` capped and labelled (R-BTN-52, R-BTN-53, R-BTN-54) |
| m18 scenarios contradict rules; m19 dangling references | S-BTN-8, -10, -11, -20, -24, -28 fixed; blob caps in §10.4; R-BTN-39 defined; §5 heartbeat settings |
| Open decisions | hook limits, module format and re-posting (R-BTN-51/52); `score`'s type; cache invalidation; `launch-advice` input (§11); `key_pattern` and positions (R-BTN-51); `hook-failed` events; "at the time" (R-BTN-46); credential ids; login links; seat ranking through advice (course spec §5) |
| Cuts | §7.3 split out; the reference repository dropped; `launch-advice` and `weight` kept (Decisions) |

*(2026-10-14 — a second fresh reviewer read `b8774978`, both specs: NOT READY, 4 blocking,
9 major, 5 minor. Resolved together with the owner's direction that courses must evolve
without Baton (§2d):)*

| Finding | Resolution |
|---|---|
| B1 legs never refresh from PR activity; snapshots ordered by docs commit only | the sync always runs its courses (§7.1); R-BTN-62 observations; R-BTN-63 the holder vouches at `advance` (G-BTN-62, -63; S-BTN-17, -36) |
| B2 suspensions can never be confirmed by ancestry | R-BTN-10 by observed legs; `ended_at_sha` an optional pointer (§4, §6.5, §6.7; G-BTN-6, -44) |
| B3 R-BTN-5 releases released or reaped tickets | R-BTN-5 checks the claim's leg in git for every claim (S-BTN-36) |
| B4 the re-check refuses the holder; rule 9 strands held claims | `advance` re-checks only the gates that bind a holder, excluding its own claim; rule 9 at claims only; R-BTN-65 (§7.2; G-BTN-63) |
| M5 the forecast's inputs are missing | ended claims' reports for `report_horizon_h`; probe readings per repository (owner) (R-BTN-52, R-BTN-53; course spec §2, §4) |
| M6 course code still vendored | R-BTN-37: vendoring is a migration state; results posted instead; boundary test over all of `src/`; `qualifyingPair` split (course spec §6) |
| M7 other awaits | §3 names the two awaits; `request_id` and nonce in the phase-3 transaction; the local queue serialises the alarm (R-BTN-55) |
| M8 no replay cache for administrators and owners | `request_nonces` by fingerprint (§4; G-BTN-55) |
| M9 cloud containers share a key | a key registers a name, an environment's for its containers (R-BTN-13, §5, §6.4) |
| M10 owner keys reachable; `required_tags` unworkable | one role per key, owners out of agents' reach (R-BTN-57); `required_tags` dropped |
| M11 `implement` while `in-progress`; legacy legs | R-BTN-5 (`implement` ready while `available` or `in-progress`); legacy claims in the first leg (§4) |
| M12 branch collisions | `{repository}` required in every pattern once a second repository registers (R-BTN-51) |
| M13 cookie tossing; login CSRF | `__Host-` cookie; Origin and JSON rule on `/v1/login` (R-BTN-16) |
| m14–m18 | one `course_id`; `expedite` column; `evidence` dropped; SQL orders resume first, one row per ticket; grants stored expanded; `handed-off` a detail; G-BTN-44 wording; R-BTN-54 and the App's reach stated; management read-only on the dashboard; Advice view input; `gatesFor` gone; hooks not `protocol_files`; course-owned activity kinds; cutover per repository |
| Overreach | `required_tags` cut; S-BTN-31 runs a parity subset locally; probes kept — the owner's Pi is the reason |

*(2026-10-14 — a third, focused reviewer read `ba6d7005`: NOT READY, 3 blocking, 7 major.
Resolved with the owner's directions that agents can change anything in git (R-BTN-66) and
that Baton does not fortify git's security model:)*

| Finding | Resolution |
|---|---|
| B1 `done` ends never confirmed (the closure is seen before the end) | `closed_tickets` kept after the rows go; `done` confirmed from the recorded closure or absence (R-BTN-10; S-BTN-40) |
| B2 the stale rule kills vouched claims; syncs post stale checkouts under new numbers | no `not-yet` staleness while a vouch is unconfirmed (R-BTN-35); number first, then fetch; no post from a strict ancestor (§7.1, R-BTN-62) |
| B3 vouched rule 1 has no positions and fails open | the sync posts every reachable leg with its bars; `advance` takes the next posted leg; `waiting` or unposted legs refused (R-BTN-63) |
| M4 one vouch slot; vouches after a release | `claim_vouches` rows that outlive the claim; claimable again only after a later observation (§6.7) |
| M5 held histories stall observations | held posts refresh legs; held rows record their observation (R-BTN-62) |
| M6 sync liveness; partial acceptance | an Actions `concurrency` group; posts accepted or refused whole (§7.1) |
| M7 the forecast's inputs | reports keyed per bucket; worker-level reports to every granted repository's hooks; `advance` carries course data (R-BTN-52; course spec §2) |
| M8 renamed legs strand tickets | `released:course-changed`; renames must raise `min_worker_version`, enforced by the test kit (R-BTN-64) |
| M9 core still fixes tier names, harnesses, reviewer parenting | ceilings per repository; harness a label; parents named by the reporter (§4, §5, §6.9) |
| M10 agents can disable course gates and detection | owner: agents can change anything in git, and Baton does not fortify git's security — owner limits live in SQLite (R-BTN-66/67); commit and marker signature checks withdrawn (R-BTN-46); `min_worker_version` defaults to `version` unless a trailer says why (R-BTN-65) |
| m11–m15 | leftovers removed; per-repository cutover in schema and API; counter semantics (last handed out, strictly greater); `POST /v1/sync/observation`; `leg: unknown`, `bars` and `vouches` in the heartbeat; `vouch-flagged` events; evidence pushed before `advance` |

*(2026-10-14 — a fourth reviewer read `4e5ab93f`: NOT READY, 2 blocking, 8 major, 5 minor.
Resolved together with the owner's course file of stations and legs (§2e), the runner
(§6.13) and webhooks (R-BTN-73):)*

| Finding | Resolution |
|---|---|
| B1 `advance` cannot skip a conditional leg; unposted legs stall it | the course file: an `advance` names any leg leaving the claim's station, loops included; no positions, pre-posted legs or vouches (R-BTN-63, R-BTN-69) |
| B2 the sync cannot see owner bars | `POST /v1/sync/observation` returns them; setting or lifting a bar dispatches a sync; hooks receive them (§7.1, R-BTN-52, R-BTN-67) |
| M3 a claim-only bar applied at advances | only `claim+advance` bars join at an advance (§7.2) |
| M4 required bars hit legs posted ahead; M5 their grammar and renames | required bars name a leg, apply when it leaves the station or is advanced into, and a course file that drops their leg is held (R-BTN-67) |
| M6 the course-change end contradicted itself | `released:course-changed` everywhere; `renamed_from` carries claims over (R-BTN-64) |
| M7 suspensions had no resume record | every end writes one (R-BTN-24) |
| M8 the query lacked "a sync since the last end" | in the SQL (§7.2) |
| M9 leftovers | tag evasion stated as undetected; S-BTN-11, `required_tags`, `.baton/baton.json` fields, the trailer name and `release-tagged` fixed or removed |
| M10 owner-bar plumbing | heartbeat bars carry `legs`, `applies` and times; `reason` a short id that is the release reason; `release_holders` follows `legs`; §10.1 lists bars and settings |
| m11–m15 | tiers posted by name, stored by position, the ceiling a parameter; admin API sets `tiers`, `weight`, `cut_over`; `closed_tickets` needs a newer observation and is cleared when a ticket returns; accepting a held history accepts its newest post; the owner's expedite override is not cleared by git |

*(2026-10-14 — a fifth reviewer read the stations revision at `0d4ef0e4`: NOT READY, 4 blocking,
11 major, 5 minor. Resolved:)*

| Finding | Resolution |
|---|---|
| B1 `advance` moved the claim to a station the work had not reached | a claim is at the last station reached; `advance` finishes the running leg and starts the next; an end names the station really reached, `reached` saying which (R-BTN-63, R-BTN-71, §11) |
| B2 `max_runs` double-counted after a sync | runs counted from the claim's `start_path` plus its own `claim_legs` (R-BTN-63, §4) |
| B3 required bars refused one-session work | the holder passes `bars` with an `advance`; required bars check posted plus declared bars, and a later snapshot lacking them is listed (R-BTN-63, R-BTN-67) |
| B4 webhooks re-triggered the sync | the sync's and mirror's own events are ignored; deliveries deduplicated; one dispatch per repository per 30 s (R-BTN-73) |
| M5 no webhook endpoint or principal | `POST /v1/github/webhook` in §3, §3a, §10.1, §11; App installation on code repositories by owners |
| M6 off-graph by station | a new path must extend the old by edges, or go backwards (§2e) |
| M7 confirmation in loops | station and path length together (R-BTN-71, R-BTN-10) |
| M8 staleness by path | a claim is ended stale only when the ticket is taken away; a backwards path is flagged to the holder and, after 30 minutes, the owner (§2e, R-BTN-35) |
| M9 the holder could not see readiness | claim, heartbeat and `advance` responses carry the latest snapshot's next legs (R-BTN-70, §11) |
| M10 runner gaps | the first leg is the first ready leg; a release aborts at a safe point with a hand-off; a course change ends `released:course-changed`; `handoff` required (R-BTN-72) |
| M11 leg sessions as children | `IR_BATON_PARENT` and `IR_BATON_STATE`: the runner's state file read-only for fence and bars, its spool for activities; leg skills never claim, advance or end (R-BTN-72, §6.8) |
| M12–M14 required-bar grammar, overclaim, S-BTN-37 | one form `{leg \| *, except?, tag_prefix}` following `renamed_from`; its limits stated; S-BTN-37 removes a leg and its station together |
| M15 legacy claims | start at the posted station with the posted path (§4, §13) |
| m16–m20 | leftovers removed; the gate table splits claim and advance; the toy course defined; `claim_legs.evidence` and a per-station board summary; the SQL's limit follows the default order |

*(2026-10-14 — a sixth reviewer read the fifth revision at `068e76e6`: NOT READY, 1 blocking,
8 major, 9 minor. Resolved, with the owner's approval of reading two named webhook payload
fields and of course-scoped bars:)*

| Finding | Resolution |
|---|---|
| B1 the webhook self-filter read payload fields "nothing but repository and event name" forbade | the fields read are listed — `repository.full_name`, `workflow_run.path`, a push's `pusher.name` and `head_commit.author.email`; `check_suite` dropped; the mirror's commit identity fixed (R-BTN-73, §10.1, §12; G-BTN-62, -68; S-BTN-42) |
| M2 the 30-second dispatch limit dropped a burst's tail | one trailing dispatch when the window closes, sent by the alarm (R-BTN-73, §3; S-BTN-42) |
| M3 the runner suspended on every `waiting` leg, CI included | `short_waits` in `course.json`; the runner keeps the claim up to 30 minutes on them (R-BTN-69, R-BTN-40, R-BTN-72; G-BTN-67; S-BTN-41) |
| M4 renames half-specified | requested and stored names resolved through `renamed_from`, runs counted under the resolved name, `claims.station`/`leg` rewritten on acceptance (R-BTN-64, §4, §11; G-BTN-63, -64; S-BTN-37) |
| M5 removing `adjudicate` would hold the file through the required bar's `except` | a missing `except` entry is dropped; only a missing named `leg` holds the file (R-BTN-67; G-BTN-66; S-BTN-37) |
| M6 bars per repository, not per course | `course` (or `*`) on owner and required bars — schema, API, heartbeat, CLI (R-BTN-67, §4, §10.6, §11; G-BTN-66; S-BTN-39) |
| M7 S-BTN-17 lacked merge bars; the runner's single edge dropped a result's `bars` | the advance into `merge` carries `bars`; the runner passes a result's `bars` on the single edge (R-BTN-72; S-BTN-17, -41) |
| M8 a suspension with git ahead of the claim was never confirmed | confirmed when the posted path extends the expected path by edges (R-BTN-71, R-BTN-10; G-BTN-44, -63) |
| M9 the backwards path was underspecified | backwards = shorter than git showed before; `claims.regressed_since` and how it clears; `git.regressed` and the path in the heartbeat; the runner aborts and suspends; a regressed suspension is confirmed by any later snapshot (§2e, §4, §11, R-BTN-72; G-BTN-59, -63; S-BTN-34, -41) |
| m10 holder-declared bars never compared with the sync's | `bars-mismatch` event and **Needs you** (R-BTN-63, §4, §14) |
| m11 overclaim | widening an exempt leg added to what a required bar cannot catch (R-BTN-67) |
| m12 the gate table and the advance gates omitted required bars and holder `bars` | both added (§7.2, rule 8) |
| m13 the runner released on `max-runs` | it suspends (R-BTN-72) |
| m14 default order: prose and SQL disagreed | expedite first in the prose, `id` tie-break in the SQL (§7.2; G-BTN-47) |
| m15 leftover wording | §7.1's off-graph rule by paths; "at each boundary" (×2) and the frontmatter's "suspend at a boundary" now stations; §2b's row by station and path; G-BTN-63's clause |
| m16 legacy adoption | `adopt` returns the station and next legs; the adopter's first `advance` re-enters its leg (§13, §11) |
| m17 GitHub App permissions and installation | read-only Contents, Pull requests and Issues beside Actions: write; installed by an organisation owner, not a Baton owner (§10.3, R-BTN-73, §10.6) |
| m18 webhook route budget | exempt from the per-IP limit; `webhook_deliveries` in the write budget (§3) |
| m19 a course-specific `claim.sh set --note` in core's §9 | the release leaves its course's hand-off document (§9) |

*(2026-10-14 — the formal review gate (R3-1228), round 1, on `1dae3316`: two blind reviewers,
A (17 findings: 1 blocking, 11 should-fix, 5 nit) and B (14: 7 should-fix, 7 nit), 5 shared
by the blind matcher — 26 distinct. Resolved, with the owner's directions that a Baton's
origin is configuration and that creating its GitHub App takes one command:)*

| Finding | Resolution |
|---|---|
| A0 (blocking) the matching SQL ignored the owner's expedite override | ordered by tag or override (§7.2 SQL, R-BTN-61, the default order) |
| A1 holds not re-checked at an advance | rule 3's hold check joins the advance re-checks (§7.2) |
| A2 = B1 hooks never received owner bars; the cache ignored them | owner bars in the hook input; bar changes and starts drop the cache (R-BTN-52) |
| A3 the live view could not show what a held claim spends | each active claim's ticket, its leg's course fields and its latest advance data (R-BTN-52) |
| A4 `{repository}` mandatory vs collisions failing safe | one rule: optional, collisions fail safe; the previous pattern stays matched (§2c, §4, §6.3; G-BTN-51) |
| A5 = B2 short `repos:` names vs `owner/name` | the sync posts `owner/name` (§7.1) |
| A6 = B4 the per-group limit before barred tags and refusals | rule 8's posted bars in the SQL; the query pages past refusals (§7.2) |
| A7 owners' overrides had no route | `POST /v1/owner/{repository}/overrides/{ticket}`, `set_by` `owner:` (§8, §10.1, §11, §4) |
| A8 = B11 per-kind detail schemas with no source; one organisation pinned | one generic detail rule; PR URLs of the ticket's repositories (§10.4) |
| A9 the `Origin` check named one host | each instance's `BATON_ORIGIN` (§3a, R-BTN-15, R-BTN-16, §14), with the owner's direction that Baton runs at any origin |
| A10 probes posting to other repositories | refused (R-BTN-13; S-BTN-30, G-BTN-54) |
| A11 two Decisions entries stated reversed rules | marked superseded (Decisions) |
| A12 a table row outside the table | indented (§7.2) |
| A13 the owning-item range | R3-1228–R3-1248 (§13) |
| A14 "a course outside every grant" | "a course of a repository no grant covers" (R-BTN-13; G-BTN-5) |
| A15 bar reasons and message senders | `reason` in heartbeat bars; `owner:`, `alarm`, `server` senders (R-BTN-67, §4, §11) |
| A16 = B13 the PR body described an old revision | rewritten against the head |
| B0 "the one unsigned route" | the Worker's checks named per route and credential (§3, R-BTN-73) |
| B3 markers "new since the parent" with a stateless sync | the sync posts all markers; Baton keeps `markers_seen` (R-BTN-46, §4, §7.1) |
| B5 the heartbeat after a ticket's own archive | `git: {closed}`; the runner ends `done` (§11, R-BTN-72) |
| B6 dashboard actions the spec relied on | Resync, adoption, unconfirmed completions, cutover — administrators' (§14, §11) |
| B7 the webhook self-filter by path alone | keyed on repository and path (R-BTN-73) |
| B8 `advice_overridden` vs `advice-overridden` | one spelling, the event kind's |
| B9 an owner bar's reason could be a closed release reason | refused (R-BTN-67) |
| B10 ids without a grammar | repository and local id patterns; the JSON path quoted (§4, §7.2) |
| B12 R3-1228's Spec line | updated on `main` |
| (owner) every Baton registers its own GitHub App | `baton admin github-app create`, GitHub's App manifest flow (§10.6) |

*(2026-10-14 — review gate round 2, one fresh reviewer on `0a5e9b94`: every round-one fix
confirmed, 7 new findings (4 should-fix, 3 nit), four of them opened by round one's fixes.
Resolved on the head that also adds R-BTN-74 (§2f, the owner's direction on ticket sources):)*

| Finding | Resolution |
|---|---|
| r2-0 the flat detail rule refused R-BTN-24's `resume` object | one nested `resume` key allowed (§10.4, R-BTN-24) |
| r2-1 paging past refusals had no cap | at most 4 pages per group per request, in order; the hook cache keyed by page (§7.2, R-BTN-52) |
| r2-2 the OIDC audience was an origin in one place and a host in others | `aud` is `BATON_ORIGIN` verbatim and `baton_url` the same string (R-BTN-56, R-BTN-13, §15) |
| r2-3 the App id had nowhere to live | `BATON_GITHUB_APP_ID`; how the installation token is minted (§3a) |
| r2-4 the previous branch pattern missing in three places | current or previous in §6.3 and §11; when the slot clears; a second change refused while it is held (R-BTN-51) |
| r2-5 the stats route outside the front door's list | `/v1/repositories/*` among the signed prefixes (§3) |
| r2-6 the first snapshot would flag every older marker | the first accepted snapshot only seeds `markers_seen` (R-BTN-46; G-BTN-50) |

*(2026-10-14 — review gate round 3, one fresh reviewer on `687b8082`: round two's fixes
confirmed but one (r2-4), 12 findings (1 blocking, 6 should-fix, 5 nit), most in the new §2f.
Resolved; the blocking one was then checked by a fresh adjudicator at the fixed head, as the
gate's last round requires:)*

| Finding | Resolution |
|---|---|
| r3-0 (blocking) the `pr` course read only open PRs, so a merged ticket went back to `filed` | open or merged PRs; every PR merged is `merged`, the end station; several PRs by the least advanced; closed unmerged counts as none (R-BTN-74) |
| r3-1 GitHub refuses approve/request-changes on one's own PR | a `<!-- baton:verdict … -->` line in a comment counts as a verdict; the `review` stub ends with one (R-BTN-74; S-BTN-43) |
| r3-2 a red check left `review` waiting forever | `review` is ready once checks finish, red or green; no checks counts as finished (R-BTN-74) |
| r3-3 the `pr` course file both absent and scaffolded | always in git, written by `baton init`; only the station function and ticket source are CLI defaults (R-BTN-74, R-BTN-51) |
| r3-4 `course_data` and tickets' opaque course had no source | `stations(ctx)` returns `course_data`, posted per course; `tickets(ctx)` returns each ticket's `course` (R-BTN-74, §7.1, R-BTN-52) |
| r3-5 two sync implementations | docs adopts `npx baton sync`; `batonSync.mjs` and `baton-sync.mjs` retire (§7.1, §15, R-BTN-74) |
| r3-6 round 2's previous-pattern fix needed branch names no snapshot posts | `previous_branch_pattern` lives in `baton.json`, posted with the registry and read by the local check; the course drops it (R-BTN-51) |
| r3-7 `@authority` vs the origin's host | the origin's authority, port included when not default (R-BTN-13) |
| r3-8 duplicate ids, unmapped names, `tags`, `default_course` | a duplicate or unmapped name fails the sync; `tags` a list; `default_course` defaults to `pr` (R-BTN-74) |
| r3-9 a non-`pr` course would get `pr`'s station function | only `pr`; any other course without `sync.mjs` fails the sync (R-BTN-74) |
| r3-10 the boundary test's classification of `src/defaults/` | exempt from the word scan, never imported by `src/core/` (§2b, §3; S-BTN-43) |
| r3-11 the PR body | updated to the head |

*(2026-10-15 — the blocks amendment (§2g, docs#213), review gate round 1 on `2d2e884e`: A (11
findings: 2 blocking, 7 should-fix, 2 nit) and B (10: 9 should-fix, 1 nit), 6 shared by the
blind matcher — 15 distinct. Resolved:)*

| Finding | Resolution |
|---|---|
| A0 = B7 (blocking) dependency blocks re-derived from `depends_on` and closures disagreed with docs; a third store | `ticket` blocks are the posted `blocked_by`; `ticket_deps` dropped (R-BTN-75, §4) |
| A1 (blocking) the resource exclusion sat in the gate query a claim re-runs | applied to recommendations only, after the gate query (§7.2, R-BTN-75) |
| A2 = B6 the fleet's capability counts ignored liveness and grants | "live" defined; liveness, grants and revocations change the counts (R-BTN-75) |
| A3 = B2 probes had no route or binding for resources | `POST /v1/probe/resources`, names registered per probe; readings stay opaque (R-BTN-76, §11) |
| A4 = B3 a worker's `until` uncapped; no precedence; no deletion | capped at 24 h, rate-limited; an owner's state wins; available unneeded rows deleted, 500 per repository (R-BTN-76) |
| A5 a resource name in a URL path | in the body (§11) |
| A6 = B1 `unblocked_workflow` outside the settings, the owner route and §10.3's dispatch scope | added to each; one JSON input `tickets` (R-BTN-66, §10.1, §10.3, §11, R-BTN-77) |
| A7 the recommend cache outlived block changes | a block change drops it (R-BTN-52, R-BTN-77) |
| A8 = B8 substitution for an unavailable line nothing performs | `needs` follows suspension substitution only; a rate-limited line blocks (course spec §6) |
| A9 the `repository?` field and the name rule | field dropped; the name rule in R-BTN-76 |
| A10 R-BTN-50's table | a row for blocks, resources and needs |
| B0 the long-poll as a third await | held in the Worker, re-asking the object (R-BTN-77) |
| B4 indexes not repository-scoped; no `ticket_requires` index by name | repository-scoped indexes; `requires_by_name` (§4) |
| B5 write amplification | one message per idle worker per heartbeat; the write budget (§3) |
| B9 S-BTN-44's gaps; the `resource` event | the scenario covers every source, the cap, precedence, isolation, `worker=me`, liveness and Needs you; `resource` logged on each change |

*(2026-10-15 — blocks, review gate round 2 on `04884eda`: round one's fixes confirmed; 10
findings (6 should-fix, 4 nit), three opened by round one's fixes. Resolved:)*

| Finding | Resolution |
|---|---|
| r2-0, r2-1 the Worker-held long-poll could not re-ask the object (replay check) and would cost thousands of requests a day | dropped: the `unblocked` message reaches an idle worker at its next heartbeat, at no extra request (R-BTN-77, §11, S-BTN-44) |
| r2-2 a ticket posted requiring a capability whose count was already zero got no row | the snapshot writing `ticket_requires` writes that ticket's capability rows (R-BTN-75) |
| r2-3 an owner's state with no end silenced reports for good; deletion erased owner rows | an owner's `until` is required, at most 7 days; owner rows in force are never deleted (R-BTN-76) |
| r2-4 the 500-row cap had no behaviour and could be filled with junk | worker reports apply only to names some posted leg needs; at the cap a new name is refused `quota` (R-BTN-76) |
| r2-5 `/v1/tickets/*` outside the Worker's signed prefixes | the route moved under `/v1/repositories/{repository}/tickets/{ticket}/blocks`; §3 names the routes there (§3, §11) |
| r2-6 the index before its table | moved after it; the join through `tickets` scopes it (§4) |
| r2-7 the alarm's new duties | listed in §3 |
| r2-8 §10.1's probe row | names resource availability |
| r2-9 the PR body | updated to the head |

*(2026-10-15 — blocks, review gate round 3 on `2ee50e63`: round two's fixes confirmed but one
(r2-3, half done); 4 findings (3 should-fix, 1 nit), none blocking. Resolved, with one more
change the formal model's review found (baton#10):)*

| Finding | Resolution |
|---|---|
| r3-0 `unblocked` messages fanned out to every past worker and never expired | alive idle workers only; the alarm expires them when liveness ends (R-BTN-77) |
| r3-1 the message's shape and the runner's duty | `{tickets: [...]}`, at most 20, updated in place; an idle `baton run` asks for recommendations on it (§9, R-BTN-77) |
| r3-2 the owner resource row still had `until?` | required, at most 7 days (§11) |
| r3-3 a silent probe could leave a name unavailable for good | the worker's default and cap apply to probes (R-BTN-76, §11) |
| (model) two overlapping sync runs could post an older reading under a higher number | Baton refuses a new number while one is outstanding (`sync-busy`); an old one is voided (R-BTN-62) |

*(2026-10-15 — external resources and decisions (`ce50cf50`), a fresh gate, round 1 (ids 4-A-n,
4-B-n): 23 findings after matching (1 blocking, 18 should-fix, 4 nit). Resolved, with the
owner's queue bounds (R-BTN-79) added in the same revision:)*

| Finding | Resolution |
|---|---|
| 4-A-0 = 4-B-0 (blocking) an account instance could serve one resource | `instance_serves`, many to many; the admin API takes `serves[]`; one reading sets every served resource; served resources share a schema (R-BTN-76, §4, §11) |
| 4-A-1 = 4-B-3 any granted worker could declare, and report on, any account | an account instance lists the repositories whose workers may use it; others are refused `forbidden` (R-BTN-76, §4) |
| 4-A-2 = 4-B-4 one readings row could not hold the administrator's precedence | an administrator's and an instrument's row per instance; an instrument reading during an administrator's is stored `overridden` (R-BTN-76, §4, §11) |
| 4-A-3 the fleet counts' triggers missed liveness, grants, registration and the snapshot | the same triggers as `fleet_capabilities`, plus registration; a snapshot writing `leg_needs` writes the rows (R-BTN-76) |
| 4-A-4 an unavailable reading's `until` never ended it | it lapses at `until` if sooner; the alarm fires then (R-BTN-76, §3, §4) |
| 4-A-5 recommendations ignored the asking worker's own instances | recommendations drop legs blocked for that worker (§7.2, R-BTN-75) |
| 4-A-6 the query ignored a leg's decision | the ready-leg `EXISTS` excludes it; rule 1 reworded (§7.2) |
| 4-A-7 an `advance` did not check decisions | in an advance's gates and the gates table (§7.2, R-BTN-45, R-BTN-78) |
| 4-A-8 = 4-B-10 Needs you lacked unknown instances | added, with open decisions (§14, R-BTN-75) |
| 4-A-9 = 4-B-13 §10.1 and the gates table not amended | the Worker, administrator and owner rows; a gates row for dependencies and decisions (§10.1, R-BTN-45) |
| 4-A-10 = 4-B-7 decision fields and `needs` unvalidated; the decision table's role | rules for `id`, `asks`, `url` (GitHub URLs of the ticket's repositories, else dropped), unknown legs on the whole ticket, `needs` by the name rule; decision blocks derive from `ticket_decisions` (R-BTN-78, §10.4) |
| 4-A-11 the course spec had the sync substituting seats with a function it cannot call | the sync posts the latest seats marker's models (course spec §6) |
| 4-A-12 = 4-B-12 an orphan schema comment; R-BTN-53's title | deleted; retitled; R3-1236's cites updated on `main` (§4, R-BTN-53) |
| 4-A-13, 4-A-14, 4-A-15 `blocked`'s description, `worker=me`, the cache's trigger | decisions named; `resource` blocks per worker; readings and lapses drop the cache (§11, R-BTN-75, R-BTN-52) |
| 4-B-1 the fleet block was vacuously true with no live worker | written only while a live worker has a usable instance; `other` lists `no-instance` (R-BTN-76) |
| 4-B-2 "blocked" was ticket-wide while rows were per leg | blocked: a whole-ticket row, or a row on every next leg; the events are its transitions (R-BTN-75) |
| 4-B-5 the `detail` schema's dialect and size | a named keyword subset, no `$ref`, `pattern` or `format`, 4 KB, 5 levels (R-BTN-76) |
| 4-B-6 the `unblocked_workflow` input was unbounded | 100 entries then `{truncated}`; validated ids; read with `fromJSON` (R-BTN-77) |
| 4-B-8 "one index" overstated; the unfiltered query unbounded | which answers are index-only restated; `worker_instances_by_instance`; 100 per page (R-BTN-75, §4, §11) |
| 4-B-9 S-BTN-44 did not cover G-BTN-70 | S-BTN-45 covers the edges; G-BTN-70 cites both (§13) |
| 4-B-11 the course spec still had the Pi's readings per repository | instance readings of the shared account (course spec §2) |

*(2026-10-15 — round 2 on `f32de3da` (ids 5-A-n): round one's fixes confirmed but two that
opened gaps; 12 findings (8 should-fix, 4 nit), none blocking. Resolved, with the owner's
notices and couriers (R-BTN-80) added in the same revision:)*

| Finding | Resolution |
|---|---|
| 5-A-0 "blocked" stored nowhere; the index-only claim false | `tickets.blocked_since` and `tickets_blocked`; the cost bullet says what each answer reads (R-BTN-75, §4) |
| 5-A-1 "every next leg has a row" vacuous with no next leg | at least one next leg; a held ticket is not blocked, and a claim changes it silently (R-BTN-75) |
| 5-A-2 a refused `uses` entry failed the heartbeat | dropped and returned in `refused_uses` (R-BTN-76, §11) |
| 5-A-3 "usable" ignored the instance's repositories | usable per repository (R-BTN-76) |
| 5-A-4 queue triggers missed fences, confirmations, course changes and late joiners | added; a joiner gets its rows in its own transaction (R-BTN-79) |
| 5-A-5 a claimed ticket's queue rows | removed silently with the claim; `advice-overridden` computed from `leg_queues` (R-BTN-79, R-BTN-75) |
| 5-A-6 the feeder index unscoped | `leg_queue_members`, keyed by repository, course and leg (§4) |
| 5-A-7 S-BTN-45's all-bounded variant | bounds and waiting tickets for `merge` and `adjudicate`; three rows per feeder ticket |
| 5-A-8 the decision URL a prefix test | checked after decoding, no dot segments, backslash, userinfo or port (R-BTN-78) |
| 5-A-9 `max_queue`'s range | 1 to 10,000 (R-BTN-79) |
| 5-A-10 the write budget | queue and notice writes counted (§3) |
| 5-A-11 the PR body | updated to the head |

*(2026-10-15 — round 3, the last, on `04f80a95` (ids 6-A-n): nine of round two's resolutions
confirmed, three completed here; 10 findings (6 should-fix, 4 nit), none blocking, so no
adjudication. Resolved:)*

| Finding | Resolution |
|---|---|
| 6-A-0 R-BTN-77 still fired on the first and last row | the events are `blocked_since`'s transitions; a claim clears it silently (R-BTN-77, G-BTN-70) |
| 6-A-1 "held" undefined in R-BTN-75; the grouping | defined once as rule 3's claim checks, cited by R-BTN-79; "not held and either … or …" (R-BTN-75) |
| 6-A-2 couriers missing from the signed prefixes and G-BTN-55 | added (§3, G-BTN-55) |
| 6-A-3 `inbox --all` used a route couriers cannot call; the role rule | `GET /v1/courier/decisions`; one role per key, `conflict` otherwise (R-BTN-80, §11) |
| 6-A-4 adding and revoking a courier across repositories | any repository's owners may add an existing courier key; a revoke removes only their registration and closes its notices; the credential goes with its last registration or by an administrator (R-BTN-80) |
| 6-A-5 a courier added later missed open decisions | queued at once on adding or a new `asks` (R-BTN-80, S-BTN-46) |
| 6-A-6 `remind_after` against deletion | 1 hour to 7 days; a sent notice is kept while its decision is open (R-BTN-80, §4) |
| 6-A-7 the alarm's scan | `notices_alarm` on (state, `not_before`), which holds the lease's end while claimed (§4) |
| 6-A-8 G-BTN-37's range | S-BTN-1…46 |
| 6-A-9 `closed` not a listed code; foreign and stale marks | `closed` listed; another courier's notice `forbidden`; a lapsed lease's mark accepted (§11, R-BTN-80) |

*(2026-10-15 — the owner then revised §2g's design: external resources with instances and
instrument readings replace the per-repository resource table (R-BTN-76, R-BTN-53), and human
decisions become a fourth kind of block (R-BTN-78). The revision goes through a fresh review
gate.)*

*(2026-10-13 — the draft at `01be1e04` was reviewed by two fresh-context agents: one on the
truth of its claims about existing code, one adversarially on the design. Every finding is
resolved above; this table maps them.)*

| Finding | Resolution |
|---|---|
| Claims: counts, witness liveness, claim order and expedite bound, `ROLES` unexpanded, note nonce, `none`/null requires, `OP` via tag, hourly usage, `claimedAt`/timelines read subjects, `next-available.sh` comparison | §1, §3, §7.2, §7.3, §12, §16 (fixed in `7235d14e`, carried here) |
| B1 mirror overwrites `in-review` with `available` | R-BTN-17 preconditions; G-BTN-8 |
| B2 "finish what you hold" vs reaping | R-BTN-6 fencing, R-BTN-18 |
| B3 snapshot order by committer time | R-BTN-11 ancestry CAS |
| M4 confirmation by the wrong evidence; orphaned `in-progress` | R-BTN-10 ancestry + status; cutover import (§13) |
| M5 lease ends before the work | §6.5: lease until done or hand-off; `in-review` an activity (§6.9) |
| M6 identity not bound | R-BTN-14 worker secret; R-BTN-13 capability allow-lists |
| M7 reaped session carries on | heartbeat returns the claim; R-BTN-7 fenced `claim.sh` |
| M8 hung harness pins an item | owner force-reap of any claim; unacked release reaped at 2 h |
| M9 cutover orphans; flag location; stale clones | §13 import, flag on `origin/main`, CI check |
| M10 claim not idempotent | `request_id`; one active claim per worker |
| M11 sync token power | R-BTN-15 OIDC; R-BTN-5 re-verify |
| M12 free text into git and the UI | §10.4 |
| M13 quota estimate and abuse | §3 write budget, rate limit, R-BTN-2 paid plan at cutover |
| M14 claim times for docs' process measurements | §12 author dates; §13 measurement-source row and export |
| M15 decisions left open | §6.4 sidecar, §11 API and errors, §12 mirror semantics, §13 shadow ingest |
| M16 commit volume | §1 honesty note; open question |
| m17 amendments | §15 |
| m18 data model | `usage_reports.provider_id`, running totals for two hours, `tier_ceiling` default, `session_name` required, CHECKs, "dead" = `reaped_at` |
| m19 same-site and Access | R-BTN-16 |
| m20 stale board, expedite bound, `human-operator` | R-BTN-5, §7.2 rule 2, R-BTN-13 |
| **Round 2** (re-review of `7724de2b`): B1 the cutover import violates the schema and locks legacy holders out | one legacy worker per item, `reap_after`, `kind: legacy` lease exemption, `adopt` (§13); G-BTN-19 |
| R2-B2 R-BTN-7 fences non-holder writes (witness, decision answers, Verify unblock, after a hand-off) | R-BTN-7 refuses only against a live holder or a fence-pending reap; G-BTN-16 |
| R2-M3 one lost first response locks a session out | sidecar-generated secret, idempotent first contact, re-key (R-BTN-14); G-BTN-17 |
| R2-M4 fencing covers only status writes; a hung agent can push after a force-reap | R-BTN-19 fence-before-re-issue; pre-tool hook denies push/merge/create/reconcile (§6.3); G-BTN-14/15 |
| R2-M5 false force-push alarms, shallow checkout, no bootstrap, indefinite freeze | §7.1 posts `origin/main` not the trigger, drops ancestors, `fetch-depth: 0`, null-parent bootstrap, 24-hour auto-accept; G-BTN-18 |
| R2-M6 confirmations stall; status equality too strict | `/end` dispatches a sync; any state past `in-progress` confirms (R-BTN-10) |
| R2-M7 agents can edit the sync workflow on `main`; the mirror fails `job_workflow_ref`; undeclared dispatch credential | both workflows named; honesty note and path-restricted push rule before cutover; Actions-write-only dispatch token (§10.3) |
| R2-M8 a stale clone does not obey the flag | nonce in the claim response and R-BTN-5; the mirror reverts or imports foreign claims (§12) |
| R2-m9 the secret is not a same-uid boundary; first heartbeat read as unauthenticated; two secret channels | §10.2 says what it is; token on every call; header only (§11) |
| R2-m10 a locally lost lease stays active on the server | the sidecar ends it `released:lease-lost` on reconnect (§6.3) |
| R2-m11 per-IP limit, legacy row values, shadow refusals | unauthenticated-only IP limit (§3); legacy credential and secret (§13); `shadow-conflict` events (§13) |
| **Round 3** (final pass on `f732142c`): R2-B1 wording — R-BTN-7 vs a legacy holder | R-BTN-7 names "another, non-legacy worker" |
| R2-M4 a tool call already running when the lease is lost can still push or merge | sidecar terminates running tool process groups before `fence-cleared`; git `pre-push` hook (§6.3); G-BTN-20 |
| R3 anyone can adopt a legacy claim by its public session name | adoption needs owner confirmation (§13) |
| R3 a re-key can clear a fence early; a refused heartbeat left the lease live locally | R-BTN-14 and R-BTN-19: re-key never clears a fence; refused heartbeat marks the lease lost; G-BTN-21 |
| R3 the foreign-claim race releases the legitimate holder | R-BTN-5 keeps the claim on a foreign nonce; mirror overwrites the foreign note; drain before cutover; pre-flag `claim.sh` stated as revert-only (§12, §13); G-BTN-22 |
| R2-M7 residual risk | the path-restricted push rule is a cutover precondition (§10.3, §13) |
| **Additions review** (activities and transcripts): B a late close or stale spool entry for an ended claim marks the next claim's lease lost | 10-minute close-only grace; a `claim-ended` refusal concerns only its claim (§6.9) |
| `orient` impossible with `claim_id NOT NULL` | `orient` alone may have no claim; linked to the next (§4, §6.9) |
| hook pairs unkeyed and unreliable; killed calls closed `succeeded` | `call_id`; denied calls open nothing; open activities close `abandoned`; matchers tested; our scripts self-report (§6.9); G-BTN-27 |
| one worker can rewrite another's activities | primary key `(worker_id, id)`; parent must share worker and claim (§4, §6.9) |
| no safe path for transcript paths; one state file, many writers | archivers append to the spool; the sidecar is the only state-file writer and drains on exit; orphan spools drained by the next sidecar (§6.8, §6.9) |
| headless `claude -p` reviewers become phantom workers | `IR_BATON_PARENT` child sessions start no sidecar; child transcripts land on the parent's activity (§6.8); G-BTN-26 |
| minors: `detail_json` vs the brace rule; reviewer parenting; budget; links | per-kind schema (§10.4); newest open round (§6.9); budget (§3); links open the file (§6.8) |
| **Suspension review**: `review-pr-claude` catalogued by its orchestrator pin | explicit `reviews_on:`/`bills:` frontmatter (§7.4); G-BTN-30 |
| substitution revives Kimi and can swap reviewer A mid-gate | substitutes only from agents seated today; seats fixed at round one (§7.4) |
| `no-new-work` strands in-flight items at the gate | spawns allowed for claims taken before the suspension (§7.4 item 2–3) |
| `awaiting-review-capacity` had no way back | `released:` with the item `available`, matching rule 8, blocked adjudicator writes its own packet (§7.2, §7.4) |
| a prefix did not resolve to one account | prefix → accounts map, one account per prefix per heartbeat, unresolved = suspended (§7.4); G-BTN-30 |
| **Final review** (fresh reviewer, CHANGES REQUIRED): F1 fence checks trusted a sidecar-only flag | R-BTN-26: every check computes the lease from the wall clock; `pre-push` asks Baton for item branches; 30 s heartbeat timeout; G-BTN-20 cases |
| F2 rule 8 could not compute "a qualifying pair exists" | R-BTN-27: the matrix as data, `familyOf`, one `qualifyingPair` used by rule 8 (per worker) and the gate; three-loop backstop; G-BTN-34 |
| F3 the cutover flag was an agent-editable file | R-BTN-28: one-way server state, sticky local marker, CI guard on the hint; `not-cut-over` defined; G-BTN-35 |
| F4–F11 minors: release vocabulary, counting policy and reset, `held` event and note, API rows, rule 9 split, R-BTN-18 cite, bump enforcement, §2 label | §6.5 closed list; §6.10; §8; §11; §7.2 rules 9–10; §3; R-BTN-22; §2 |
| **Final review, round 2** (CHANGES REQUIRED): M the fake clock had no seam, and an env-var seam would bypass the fence | R-BTN-32: one `batonNow()`, no env var, a test-only offset file gated on a loopback test-harness sidecar, an injected DO clock; `pre-push` always queries Baton after cutover; SIGSTOP sleep; G-BTN-38 |
| minors: staging trust of the test key; R-BTN-19's reason; `review-capacity` hold and loop reset; R-BTN-26 circularity; post-hoc CI checks; author family vs claimant; the `baton` project | §13a; §6.6; §4, §7.4; R-BTN-26; R-BTN-22/28; R-BTN-27 author families; R-BTN-31 |
| **Final review, round 3**: APPROVE WITH NITS — N1 the lease-lost `pre-push` refusal covered `docs/main`, blocking a fenced session's note; N2 a proxied test-harness sidecar could register | §6.3 layer 3 limited to item branches; R-BTN-32 `test_harness` flag refused from non-test credentials |

*(2026-10-15 — §2h, positions, history, contracts and replay (docs#214), review gate round 1 on
`1efc90e0` (ids 1-A-n, 1-B-n): 23 findings after matching (5 blocking, 15 should-fix, 3 nit).
Resolved:)*

| Finding | Resolution |
|---|---|
| 1-A-0 = 1-B-8 a schema violation was `cannot-finish:spec`, non-retryable, yet said to count toward backoff | a class of its own, `contract`: an output's is a failed attempt, an input's raises `baton:contract` (R-BTN-82, §6.10) |
| 1-A-1 = 1-B-5 (blocking) the next snapshot closed every Baton-raised decision; `baton:` ids unreserved | a snapshot rewrites only `source: sync` rows; the prefix is reserved; `park` and re-raising stated (R-BTN-78, §4) |
| 1-A-2 = 1-B-6 (blocking) `baton:stalled` made advice a gate | raised only for a leg posted `waiting` 72 hours (`waiting_since`), closing when it is `ready`; advice never raises one (R-BTN-78) |
| 1-A-3 = 1-B-3 the re-route had no storage | `ticket_overrides.route_leg`, `route_station`, cleared when the station changes (R-BTN-83, §4) |
| 1-A-4 = 1-B-7 the runner, claim and recommendations still used every ready leg | the queued leg alone; a first advance into another is `not-queued`; G-BTN-67, S-BTN-41 (§6.13, §7.2, §11) |
| 1-A-5 = 1-B-4 `start_leg` required in one place, optional in another | always required; `next_source: course` (R-BTN-69, R-BTN-83, §4) |
| 1-A-6 = 1-B-0 (blocking) `git:` URIs could name any repository; foreign markers' outputs reached legs | URIs limited to the ticket's repositories, paths validated; outputs only from markers of the ticket's claims (§10.4, R-BTN-82) |
| 1-A-7 = 1-B-2 `artifact_buckets` undefined | a repository column its owners set (§4, §10.1) |
| 1-A-8 = 1-B-13 no retention or bounds for history and pointers | the alarm's 90-day deletion; `detail_json` ≤ 2 KB; 10 rows per candidate to hooks; the write budget (R-BTN-81, §3, §4) |
| 1-A-9 the `queue-over` payload had nowhere to live | `notices.payload_json`; the courier response's shape; `intake` replaces `oldest_since` (R-BTN-79, §4, §11) |
| 1-A-10 = 1-B-14 G-BTN-70 and S-BTN-45's G case used the old "blocked" | the queued-leg definition; G's queued leg named |
| 1-A-11 the history API lacked `run` and `snapshot_sha`, which replay reads | added; replay reads inputs from `leg_run_inputs` (§11, R-BTN-81, R-BTN-84) |
| 1-A-12 S-BTN-47 expected Baton to refuse what the runner catches first | the runner suspends; a direct advance is refused `off-graph` |
| 1-A-13 = 1-B-11 R3-1233 and R3-1234 kept the old `locate` shape and marker | updated (items) |
| 1-A-14 R3-1255 depended on unbuilt queued legs | R3-1257 filed to build §2h; R3-1255 depends on it |
| 1-A-15 R3-1255's exit criterion named an untested intake case | the intake test added |
| 1-B-1 marker fields unescaped | percent-encoded values; `locate` decodes before validating (§10.4) |
| 1-B-9 (blocking) `input-version` refused at the advance, looping claim, refusal and suspension | stored `waiting` before the leg is offered; the advance refusal a backstop with no failed attempt (R-BTN-82) |
| 1-B-10 `course-changed` had no writer and clashed with snapshot validation | Baton stores it on course-file and snapshot acceptance, which does not refuse for it (R-BTN-83) |
| 1-B-12 replay's no-write promise was unenforceable for agent legs | git and forge credentials withheld; the provider key kept (R-BTN-84) |
| 1-B-15 several marker writers per leg run | one closing marker per run carries the position and outputs (R-BTN-83) |
| 1-B-16 the `path` comment and `next_source`'s default | `[{leg, reached}]`; no default, `course` added (§4) |
| 1-B-17 inputs stored twice | the history's `inputs` row names `leg_run_inputs` rows (R-BTN-81) |

*(2026-10-15 — round 2 on `4f8f4bfd` (ids 2-A-n): round one's resolutions confirmed but four not
carried through and one that opened two defects; 14 findings (2 blocking, 11 should-fix, 1 nit).
Resolved, with the owner's discrepancy log (R-BTN-85) added in the same revision:)*

| Finding | Resolution |
|---|---|
| 2-A-0 (blocking) one `contract` class, told apart only by `detail`; the input case unheld and counted | two reasons core reads: `contract-output` (a failed attempt) and `contract-input` (held at once, not counted, `baton:contract`) (R-BTN-82, §6.5, §6.10, §4) |
| 2-A-1 (blocking) `route <producer>` impossible | the producer is re-run in git, then `retry`; Baton never moves a ticket backwards (R-BTN-82, R-BTN-78) |
| 2-A-2 `park` and `retry` on `baton:stalled` assumed a hold | stated per decision: `retry` restarts its clock, `park` sets an owner hold `parked` (R-BTN-78) |
| 2-A-3 the input waits were lost on the next snapshot | re-applied in every transaction that writes the ticket's next legs (R-BTN-82) |
| 2-A-4 outputs could not be tied to their marker; the rationale overclaimed | outputs posted with `ref` and `claim_nonce`; `claim_id` required; a filter against workers' mistakes, not commenters (R-BTN-82, R-BTN-46) |
| 2-A-5 agent legs pushed the closing marker before validation; `replay_safe` refused them | the runner writes the closing marker from the validated result; `locate` ignores invalid pairs; `replay_safe` is about side effects beyond git and the forge (R-BTN-83, R-BTN-82, §6.13) |
| 2-A-6 no `run`/`snapshot_sha` columns; no route returned replay's inputs | columns added; history `inputs` rows carry their joined inputs (§4, §11) |
| 2-A-7 the 90-day deletion rescanned every closed ticket | `closed_unpurged` index, `purged_at`, `run_inputs_by_ticket` (§4, R-BTN-81) |
| 2-A-8 `start_leg` missing from the example and the acceptance checks | added to both (R-BTN-69) |
| 2-A-9 the hook input still said 50 history rows | 10 per candidate, at most 50 candidates (§2c) |
| 2-A-10 G-BTN-73/74, §14 and R-BTN-70's sources stale | brought in line |
| 2-A-11 Baton decisions' notices never closed | closed in the transaction that closes the decision (R-BTN-80) |
| 2-A-12 the age key used every ready leg | the queued leg's `ready_since` (§7.2) |
| 2-A-13 the PR body | updated |

*(2026-10-15 — round 3, the last, on `347c6962` (ids 3-A-n): ten of round two's resolutions
confirmed, two completed here and one that opened the blocking finding; 10 findings (1 blocking,
8 should-fix, 1 nit). Resolved, the blocking finding then adjudicated:)*

| Finding | Resolution |
|---|---|
| 3-A-0 (blocking) a runner that knows no course could not write the closing marker | the leg script's `close(ctx, result)` writes it where the course's convention puts it, called only after validation; for `roadmap-pr`'s review, the verdict marker from the agent's result (R-BTN-83, §6.13) |
| 3-A-1 a `contract-input` hold also raised `baton:retries` | excluded (R-BTN-78) |
| 3-A-2 clearing the hold outside resolve left the decision open | any owner act that clears the hold closes the decision and its notices (R-BTN-78) |
| 3-A-3 a give-up naming another leg never reached git; the edge test undefined for give-ups | `close` writes it too; one edge test for both (R-BTN-83) |
| 3-A-4 R-BTN-85's triggers and its relation to existing events undefined | seven triggers, each a `sub`; a discrepancy accompanies the existing events; a history kind (R-BTN-85, §4) |
| 3-A-5 Baton could not log a marker `locate` ignored | posted in the station's `ignored` (§7.1, R-BTN-83) |
| 3-A-6 S-BTN-47 never overrode a value Baton held | a reported position a person's approval overrides, and a route cleared by a station change |
| 3-A-7 replay withheld the credentials it needs to read and ran on `main`'s tree | read-only credentials kept, write-capable withheld; the leg's `head_sha` checked out (R-BTN-84, §4, §11) |
| 3-A-8 whether Baton-stored waits raise `baton:stalled` | sync-posted waits only (R-BTN-78) |
| 3-A-9 R3-1257 stale | updated (items) |

The adjudicator found 3-A-0 reproduced at `347c6962` and fixed at `b56736e7`; its six follow-ups (the test kit's exports, §6.12's evidence markers and the `baton:close` kind, `close` failing, the order of `close` and `handoff`, two wordings, the `pr` course's stubs) are folded in after it.

*(2026-10-15 — §2i (docs#215), review gate round 1 on `a8b90729` (ids 1-A-n, 1-B-n): 20 findings
after matching (6 blocking, 13 should-fix, 1 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 1-A-0 (blocking) a dependency cycle through R3-1251 | R3-1253 no longer depends on R3-1251 (items) |
| 1-A-1 = 1-B-1 (blocking) fan-in given to `locate` and one leg | the ticket source adds open children to `blocked_by`; the default does; whole-ticket (R-BTN-86, R-BTN-74) |
| 1-B-2 the parent offered before the sync posted its children | the leg reports `spawned`, which blocks the parent provisionally (R-BTN-86, §11) |
| 1-A-2 = 1-B-3 `parent` unvalidated; a whole snapshot refused for one file | same repository, local id; self, cycle, depth over 5 edges dropped and logged `parent-invalid`; unknown stored as orphaned; no snapshot refused (R-BTN-86) |
| 1-A-3 = 1-B-4 closed children unlisted | `closed_tickets.parent` (§4) |
| 1-A-4 R-BTN-33 and R-BTN-74 field lists | `parent` added |
| 1-A-5 (blocking) no procedure to move a Baton | freeze, drained export, import, keep or change the origin, source retired (R-BTN-88, §11) |
| 1-A-6 (blocking) dropped claims stranded `in-progress` tickets; the event sequence restarted | export refused while a claim is active; `events_seq` exported and continued (R-BTN-88) |
| 1-A-7 (blocking) ticket-scoped rows imported before their tickets existed | `pending_owner_state`, applied when the ticket first appears (R-BTN-88, §4) |
| 1-A-8 history said to be rebuilt | stated as lost unless `--with-history` (R-BTN-88) |
| 1-A-9 = 1-B-9 format, digest and "empty" undefined; atomicity, schema versions, `cutover_at` | the document's sections, SHA-256 over RFC 8785 JSON, verified; empty defined; one transaction; same schema version; `cutover_at` in `repositories` (R-BTN-88) |
| 1-B-5 (blocking) worker secret hashes were not exported | `workers` exported (R-BTN-88) |
| 1-A-10 S-BTN-50 compared worker-dependent state too early | compared after the heartbeat and the reading |
| 1-A-11 = 1-B-7 no latency budget, mix, window or burst unit; nothing past 100% | p99 budgets per route, the mix per minute, 5-minute means, 100 in 5 seconds; advisory past 100% (R-BTN-87) |
| 1-B-8 20 requests a second not derived | stated as owner targets with the derived mix and row writes (R-BTN-87) |
| 1-A-12 `capacity` without window or transitions; Needs you | logged on crossing each way; in Needs you (R-BTN-87, §14) |
| 1-A-13 = 1-B-0 §13, §13a and the owning items not amended | load test in §13's preconditions and §13a; R3-1258 owns §2i; the status header names §2h–§2i |
| 1-B-6 the staging load test needed test keys | driver-generated keys an administrator registers, and a real sync credential (R-BTN-87, §13a) |
| 1-B-10 several Batons per worker had no mechanism | one worker session, sidecar and state file per Baton (R-BTN-87) |
| 1-A-14 no `spec-edited` provenance trailers | carried from this commit on |

*(2026-10-15 — §2i (docs#215), review gate round 2 on `9167fb26` (ids 2-A-n): 11 should-fix.
Resolved:)*

| Finding | Resolution |
|---|---|
| 2-A-0 `parent` local in R-BTN-86, qualified in S-BTN-49 and §4 | local id in the file; Baton qualifies it with the posting repository and stores that; S-BTN-49 writes `parent: T` |
| 2-A-1 `spawned` on an `advance` did not stop the holder | `spawned` on an `end` only; the spawning holder ends its claim (R-BTN-86, §11) |
| 2-A-2 a stale snapshot replaced the provisional blocks | kept until the first accepted snapshot observed after the end, as R-BTN-10 (R-BTN-86; S-BTN-49) |
| 2-A-3 the dropped child's discrepancy had no `sub` | `spawned-unposted` added to R-BTN-85's triggers |
| 2-A-4 `spawned` unbounded and unvalidated | at most 50, the ticket-id rule, never the parent (`invalid-params`); a live id blocks the same way (R-BTN-86, §11) |
| 2-A-5 the export's `workers` subset and a `required_bars` section | every §4 column; `last_seen_at` imported as 0; `required_bars` inside `repositories` (R-BTN-88) |
| 2-A-6 the frozen source logged events after the export | the export seals the source: `sealed` is the last event, then no events, no alarm, no syncs (R-BTN-88, §4) |
| 2-A-7 freeze one-way and unstored | `unfreeze` until the export; `baton_settings` `frozen_at`, `sealed_at`; exports are moves, backups are the storage's (R-BTN-88, §4, §11) |
| 2-A-8 R3-1220 did not depend on the 2026-10-15 items | R3-1251 and R3-1253–R3-1258 added to its `depends_on` (items) |
| 2-A-9 the staging load test needed 20 real repositories and an administrator | staging: the worker load and one real sync; the 20-repository board load locally; R3-1258 requires `human-operator` (R-BTN-87, §13a) |
| 2-A-10 200,000 history rows below the mix's steady state | derived: about 11,500 rows a day, near 1,000,000 under 90-day retention; the load test seeds it (R-BTN-87, §13a) |

*(2026-10-15 — §2i (docs#215), review gate round 3 on `685e2dfa` (ids 3-A-n): 11 findings
(1 blocking, 9 should-fix, 1 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 3-A-0 (blocking) the seal cut the mirror off from the drain's last events | the seal waits for every mirror's acknowledged cursor (`repositories.mirror_acked_seq`) and dispatches the laggards (R-BTN-88, §4; S-BTN-50) |
| 3-A-1 `closed_tickets` neither exported nor named lost | exported (R-BTN-88; S-BTN-50) |
| 3-A-2 one decision per ticket in `pending_owner_state` | `key` (the decision id) in the primary key (§4; S-BTN-50) |
| 3-A-3 no code for a frozen or sealed refusal | `frozen`, and `sealed` (503, retryable, never a re-key) (§11; S-BTN-50) |
| 3-A-4 a `GET` sealed the source; re-export unspecified | `POST /v1/admin/seal`; the export only from a sealed source, repeatable and identical (R-BTN-88, §11) |
| 3-A-5 the Cloudflare budgets unmeasured at the envelope's size | staging seeded by a synthetic `--with-history` import and one real repository posting a 5,000-ticket board (R-BTN-87, §13a) |
| 3-A-6 `spawned` with `done` or `released:` unspecified | `suspended:` and `released:` write the blocks; `done` with `spawned` is refused (R-BTN-86, §11; S-BTN-49) |
| 3-A-7 row writes omitted `request_nonces` | about 330,000 a day with the nonces, about 10 million a month (R-BTN-87, §3) |
| 3-A-8 R3-1258 untagged `OP` | tagged (items) |
| 3-A-9 S-BTN-50 said "frozen" | sealed |
| 3-A-10 the PR body stale | rewritten to the spec at this commit |

*(2026-10-15 — §2j (docs#216), review gate round 1 on `d9d92682` (ids 1-A-n, 1-B-n): 20 findings
after matching (2 blocking, 13 should-fix, 5 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 1-A-0 (blocking) a due `time` wait called an unblocking with no block row | the alarm queues `unblocked` with `cleared: [{kind: 'time'}]`, no workflow dispatch; `time` listed under R-BTN-75's `other` (R-BTN-89) |
| 1-A-1 (blocking) the deadline ran on through the wait under the claim | the heartbeat's `leg_finished` clears it when the leg's script returns (R-BTN-90, §11; S-BTN-52) |
| 1-A-2 `not_before` missing from the leg result and the `next` entries | `not_before?` in R-BTN-72's result and in every `next` entry (§11) |
| 1-A-3 two sources for `not_before` | the station's wins; the ticket's applies at `start` only when the station posts none (R-BTN-89) |
| 1-A-4 = 1-B-0 `not_before` unvalidated and silent | RFC 3339, at most 400 days ahead, else dropped and logged `not-before-invalid` under Needs you; waits shown on the dashboard (R-BTN-89, §4) |
| 1-A-5 = 1-B-5 the stored `time` state undefined | `waiting` on `time` only over a posted `ready`, re-applied in every write and by the alarm; `time` reserved; `ready_since` = `not_before`; `not_before` cleared; the due index on the predicate (R-BTN-89, §4) |
| 1-A-6 = 1-B-2 §6.10 excluded and counted the reap | actor `alarm:leg-timeout`, counted; the exclusion and §6.6 amended |
| 1-A-7 the deadline route's bounds | `extend_to` refused with no deadline or once the release is queued, current leg only; `cancel_at` within 7 days (R-BTN-90, §11) |
| 1-A-8 no trailing ring | a trailing ring at the second's end, through the alarm (R-BTN-91; S-BTN-53) |
| 1-A-9 = 1-B-1 the upgrade did not identify the worker | `session_name` in the signed query and `X-Worker-Secret`, checked as a heartbeat is; closed when the worker stops being alive (R-BTN-91, §11; S-BTN-53) |
| 1-A-10 G-BTN-37's range | S-BTN-1…53, the last three not cutover preconditions |
| 1-A-11 the model change unowned | R3-1259 changes `model/` in its PR (items) |
| 1-A-12 = 1-B-3 §3's alarm and write budget; latency | the new alarm duties; the alarm set early to the earliest pending instant; rings in the write budget (§3) |
| 1-A-13 R3-1259's tests | the 30-minute boundary, `writeSuccessor`'s branches, `max_duration`'s bounds (items) |
| 1-A-14 §9's reasons and R-BTN-78's waits | `leg-timeout` and its 15 minutes in §9; `time` in R-BTN-78 |
| 1-A-15 auto-response pair and local framing | `ping`/`pong` every 30 seconds; the `ws` package locally (R-BTN-91, R3-1260) |
| 1-B-4 the successor's branch, idempotency and window | the default branch, before the run's closing commit; id from the series and its instant; nothing written twice (R-BTN-89; S-BTN-51) |
| 1-B-6 `extend_to` worded two ways | one wording, as 1-A-7 |
| 1-B-7 the ring's state lost on hibernation | in the socket's attachment (R-BTN-91) |
| 1-B-8 helpers in the test kit | in the leg-script module `baton/leg` (R-BTN-89) |

*(2026-10-15 — §2j (docs#216), review gate round 2 on `d384d579` (ids 2-A-n): 11 findings
(1 blocking, 5 should-fix, 5 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 2-A-0 (blocking) the result's `not_before` never reached Baton | `not_before?` on `end`; the provisional queued leg waits on `time` from it (R-BTN-89, §11; S-BTN-51) |
| 2-A-1 `leg_finished` waited for the next heartbeat | sent at once, out of cadence; withdraws a still-pending `leg-timeout` release (R-BTN-90; S-BTN-52) |
| 2-A-2 the successor id moved on a late retry | from the run's number, `<series>-<n+1>` (R-BTN-89; G-BTN-79) |
| 2-A-3 invalid values failed open; schedules unbounded | fail closed: `waiting` on `not-before-invalid` under Needs you; `NOT_BEFORE_HORIZON_DAYS` enforced by `nextFire` and `writeSuccessor` (R-BTN-89) |
| 2-A-4 the cache and the recipients | the alarm drops cached recommendations; only workers the ticket would pass the gates for (R-BTN-89, R-BTN-52) |
| 2-A-5 R3-1259 missed `locate`, the ticket source and the responses | added (items) |
| 2-A-6 the bound measured from a counter | from Baton's `now` at acceptance (R-BTN-89) |
| 2-A-7 S-BTN-53's hibernation outcome unobservable | state recovered from `deserializeAttachment` after re-instantiation |
| 2-A-8 reconnect in lockstep | full jitter, reset after a minute open (R-BTN-91) |
| 2-A-9 `cancel_at` lapsed silently | lapses with the claim, logged and shown (R-BTN-90) |
| 2-A-10 a re-posted past instant | stored as NULL; `ready_since` kept (R-BTN-89) |

*(2026-10-15 — §2j (docs#216), review gate round 3 on `0e473dfb` (ids 3-A-n): 11 findings
(8 should-fix, 3 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 3-A-0 a retried run overlapped its successor | the successor's `depends_on` names the current run (R-BTN-89; S-BTN-51, G-BTN-79) |
| 3-A-1 a foreign file at the successor's id stopped the series silently | matched by `parent` and `run`, else `cannot-finish:spec`; likewise an id the rule refuses (R-BTN-89; S-BTN-51) |
| 3-A-2 S-BTN-52 never reached the withdrawal | W0b after its deadline, release pending; W0c delivered, standing |
| 3-A-3 the lapse tested in the wrong scenario | moved to S-BTN-52 and G-BTN-80 (R3-1259) |
| 3-A-4 `not-before-invalid` missing from two lists | added to R-BTN-78's and §14's |
| 3-A-5 `not-before-invalid` against a posted wait | overrides a posted `ready` only (R-BTN-89) |
| 3-A-6 the withdrawal's representation | `expired` with `withdrawn: 'leg-finished'`, a `leg-timeout` event `{withdrawn: true}`; `alarm:leg-timeout` in the actor list (R-BTN-90, §4) |
| 3-A-7 nothing bounded the claim after `leg_finished` | the deadline re-armed to now + 40 minutes (R-BTN-90; S-BTN-52, G-BTN-80) |
| 3-A-8 the horizon constant's authority | one module, imported by `src/validate.ts` (R-BTN-89; R3-1259) |
| 3-A-9 `not_before` on an end without `next` | refused, as with `done` (§11) |
| 3-A-10 the PR body stale | rewritten to the spec at this commit |

*(2026-10-16 — §2k (docs#217), review gate round 1 on `43baa266` (ids 1-A-n, 1-B-n): 29 findings
(4 blocking), 21 after matching. Resolved in the revision that follows:)*

| Finding | Resolution |
|---|---|
| 1-A-0 = 1-B-0 the want's clearing rule compared a number with a time and lost a want raised mid-run | `sync_wanted_after` holds the counter's value at the latest want; only a post numbered strictly above it clears (R-BTN-94; S-BTN-56, G-BTN-83) |
| 1-A-1 = 1-B-2 a verdict compared with the head's author could never count; ordering, merge detection unstated | verdicts are empty commits with `Baton-Verdict` and `Baton-Reviewed: <sha>`; first-parent walk; a branch needs a commit off the default branch; `merged` by a `Baton-Ticket` trailer on the default branch (R-BTN-96) |
| 1-B-1 `post-receive` ran only on the default branch | runs on a push to any ref (R-BTN-94) |
| 1-B-3 identity-based independence spoofable and against `pr`'s shared-identity choice | dropped, as for `pr`; a repository needing independence writes its own course (R-BTN-96) |
| 1-A-2 a branch at main's tip `merged` at once; several branches; squash merges | a branch counts only with a commit off the default branch; least advanced; the trailer survives a squash and a deleted branch (R-BTN-96) |
| 1-A-3 "a plain repository needs nothing else" | it needs the cron loop for wants no push carries (R-BTN-94) |
| 1-A-4 = 1-B-11 the mirror had no pulled want; the seal assumed `mirror_workflow` | the mirror's want is its unread events; `GET /v1/sync/wanted` answers per role; the seal waits for every mirror (R-BTN-94, R-BTN-88) |
| 1-A-5 one forge path on two forges collided | unique per forge host; another host's repository named by `web_base` (R-BTN-92, §4) |
| 1-A-6 = 1-B-9 "under the `web_base`" was a bare prefix | one link rule: WHATWG parse, host and port, whole leading segments, no dot segments, userinfo or encoded `/`; `web_base` validated (R-BTN-92, R-BTN-78, §10.4) |
| 1-A-7 GitLab `id_tokens` roles, key set, `sync_workflow` | the audience names the role; key set at `<issuer>/oauth/discovery/keys`; `ci_identity` (R-BTN-93, §4) |
| 1-A-8 = 1-B-10 notify secrets in the object; code repositories' notifications | forge secrets in the Worker secret `BATON_FORGE_SECRETS`, verified in the Worker; code repositories post to a home repository's route (R-BTN-95, §3, §3a) |
| 1-A-9 = 1-B-6 `sync_keys` outside `credentials`; the role count | a `credentials` row of kind `sync` plus `sync_key_repositories`, so one-role, revoke and export reach it; one key may serve several repositories (R-BTN-93, §4) |
| 1-B-7 the export omitted sync keys; secrets after import | exported with `credentials`; forge secrets are the deployment's, never exported (R-BTN-88, R-BTN-94) |
| 1-A-10 = 1-B-8 `sync_workflow` NOT NULL; `remote` backfill; GitLab and dispatch settings | `sync_workflow` nullable; the migration's backfill stated; `ci_identity`, `dispatch`, `unblocked_trigger` columns (§4) |
| 1-A-11 `--defaults-only` through `npx` ran the checkout's CLI | runs only from a CLI installed outside the checkout, refusing otherwise (R-BTN-97) |
| 1-A-12 a `git` repository named by its `remote` broke `git:` URIs and `?repo=` | a `git` repository has an administrator-chosen `owner/name`-shaped forge path (R-BTN-92) |
| 1-A-13 = (part of 1-B-8) the unblocked trigger off GitHub | `unblocked_trigger` of the `dispatch` shape; R-BTN-77, the settings table and the owner route amended |
| 1-A-14 = 1-B-5 GitHub-only sentences left; 1-B-4 the `pr` station function's scope | a reading rule in §2k; §2c, §3, §6.8 and G-BTN-23, R-BTN-78, R-BTN-74, §7.1 and §11 amended in place |
| 1-B-12 scenarios missing; S-BTN-55's other-repository case could not arise | S-BTN-56 (GitLab and Gitea, `id_tokens`, the mid-run want, a failed dispatch, links, `--defaults-only`); `?repository=` on multi-repository keys |
| 1-B-13 a sync key unbound to a branch; "writes nothing"; R-BTN-97 unchecked | said so: posts still checked against the default branch (R-BTN-11); only the nonce is written; R-BTN-97 is the operator's obligation |

*(2026-10-16 — §2k (docs#217), review gate round 2 on `60281ded` (ids 2-A-n): 13 findings (1
blocking, 11 should-fix, 1 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 2-A-0 (blocking) S-BTN-54 still barred the head's author from reviewing | the case is now a verdict naming an older content commit (S-BTN-54) |
| 2-A-1 a sync key as a plain CI secret is readable by any branch's runs; R-BTN-11 checks only ancestry *(closure corrected 2026-10-18 by R-BTN-156: a protected variable reaches every protected ref)* | the key must be a secret only default-branch runs can read (GitHub environment, GitLab protected variable); the ancestry overclaim removed (R-BTN-93) |
| 2-A-2 GitLab tokens unchecked for `ref_type` | `ref_type` must be `branch` (R-BTN-93) |
| 2-A-3 the Worker lacked each repository's forge and issuer; an `iss` could name any URL | `BATON_FORGE_SECRETS` entries carry `forge` and `gitlab_issuer`; only listed issuers are fetched; the object matches `ci_identity.issuer` (R-BTN-94) |
| 2-A-4 a `post-receive` sync refused `sync-busy` lost the push | the hook records a want first (`POST /v1/sync/want`) (R-BTN-94, §11) |
| 2-A-5 the mirror's want stayed true after a complete run | only events of kinds the mirror writes; a run ends with a read at its final cursor (R-BTN-94) |
| 2-A-6 an owner could join another repository's sync key | only an owner of both, else `conflict`; the administrator may (R-BTN-93) |
| 2-A-7 the unblocked trigger's credential and target | the repository's own dispatch credential and target; owners pick only the workflow (R-BTN-94) |
| 2-A-8 which repository the `branch` course reads | the home repository only (R-BTN-96) |
| 2-A-9 lookups by forge path alone | every lookup names its forge host; GitHub's token and App deliveries look among `github.com` repositories (R-BTN-92) |
| 2-A-10 Gitea's PR path | `/pulls/<n>` (§10.4) |
| 2-A-11 the PR body stale | rewritten to this revision |
| 2-A-12 `invalid-params` missing from `verifySync`; the App's secret; §6.8; the owner row | added; the App uses `BATON_GITHUB_APP_KEY`; "access to the transcript repository"; the duplicate removed |

*(2026-10-16 — §2k (docs#217), review gate round 3, the last, on `b92b492c` (ids 3-A-n): 15
findings (1 blocking, 11 should-fix, 3 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 3-A-0 (blocking) a sync key serving several repositories sat where one repository's code runs and could post another's board | one repository and role per sync key (`sync_keys`, one row per key); `?repository=` and its `invalid-params` withdrawn; round 1's 1-A-9 resolution narrowed (R-BTN-93, §4, §11; S-BTN-55) |
| 3-A-1 the `post-receive` hook runs as the pusher and held the push open | the hook only touches a spool file the sync account watches; that loop records the want and runs the sync (R-BTN-94) |
| 3-A-2 "has a mirror" undefined on GitLab | `ci_identity.mirror`; "has a mirror" defined for the seal and Needs you (R-BTN-93) |
| 3-A-3 `sync_wanted_after` before the first number, and across an import | 0 before any number; wants are not exported, an import clears them (R-BTN-94) |
| 3-A-4 whether a held post clears the want | an accepted or held post clears it; the hold is listed on its own (R-BTN-94) |
| 3-A-5 a `Baton-Ticket` trailer anywhere in history | the default branch's first-parent history only (R-BTN-96) |
| 3-A-6 the cross-host `repos:` form reached no other rule | withdrawn: a ticket's repositories share its home's forge host (R-BTN-92, §7.1) |
| 3-A-7 the forge path's grammar | given: segments, counts per forge, case-insensitive (R-BTN-92) |
| 3-A-8 the admin change route lacked the new fields | `remote`, `web_base`, `ci_identity`, `dispatch`, the workflows and sync keys; never `forge` or the forge path (§11) |
| 3-A-9 Gitea's dispatch token reaches every repository its user writes | a bot user with write access to that repository only (R-BTN-94) |
| 3-A-10 GitLab and Gitea own-work fields | the accepted events and fields per forge named; no pipeline or workflow-run events, so no sync loop (R-BTN-95) |
| 3-A-11 a transcript repository's forge | `<forge>:<web_base>` entries (§6.8) |
| 3-A-12 `merged` versus "no branch" | `merged` judged first (R-BTN-96) |
| 3-A-13 §10.1 lacked the notify and want routes; stale `unblocked_workflow`; "GitHub wins" | rows added; renamed; the reading rule covers "GitHub wins" |
| 3-A-14 a GitHub repository without the App had no notification path | the notify route takes a GitHub repository webhook under the repository's own secret (R-BTN-95) |

*(2026-10-18 — §3b tenancy, review gate round 1 on `eba7dd8` (ids 1-A-n security, 1-B-n
consistency): 35 findings (5 blocking, 17 should-fix, 13 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 1-A-0, 1-B-1 (blocking) per-claim stream objects named by claim id collide across tenants | every Durable Object named under its tenant, `'<tenant id>/stream/<claim id>'`; `Stream` added to the ports; R-BTN-118 and §2m.7a annotated (R-BTN-135) |
| 1-A-1 (blocking) the commands that write deployment secrets are the operator's in a shared Worker | one secret sink chosen by configuration — `wrangler`, `file`, later `operator` — so commands and powers stay; R-BTN-57 annotated (R-BTN-136) |
| 1-B-0, 1-A-5 (blocking) no per-origin runner configuration; a pusher could redirect a machine's origin | `runner.json` `origin`, `BATON_URL` beside `IR_BATON_KEY`, a checkout with another `baton_url` refused, `origins.json`, per-origin `keys.json`; stated as no boundary (R-BTN-137) |
| 1-B-2, 1-A-6 (blocking) `repo identify` and the ids had no wire contract; the path could not change | ids on the §11 register and change bodies, required for new forge repositories, replaced only with `confirm`; once stored the ids decide and a verified rename updates the path; `repo identify` is the change action's command; scope line corrected (R-BTN-138) |
| 1-A-3, 1-B-3 rate limits crossed tenants and counted unverified keyids | keyed by tenant and credential, verified requests only; per-IP keyed by host and IP; §3 annotated |
| 1-A-4, 1-B-6 caps could cost a lease; `too-large` misused; one-shot commands; retries | no cap on lease upkeep and no reaping while capped (P5); storage caps `quota`; retries re-signed; one-shot commands exit within 60 seconds; §6.3 annotated; Baton's own clients only |
| 1-A-2 the signed `forge-check` notice named no tenant; `keys/signing` mis-documented | `origin` and `forge_repo_id` signed; §11 row lists keys by `kid`; a check App serves one tenant (R-BTN-136) |
| 1-A-7 routing by host unstated; `workers.dev` and preview URLs | served only at its origin from today, URL host only, comparisons against the configured origin, `workers_dev`/`preview_urls` off (R-BTN-135) |
| 1-A-8 tenant id reuse; how the object knows its tenant | ids never reused, retirement deletes storage, `baton_settings.tenant_id`, a mismatch `forbidden` (R-BTN-135) |
| 1-B-4 ids not unique; rename stranded | `forge_host` column and a unique index among live rows; a rename onto a retired row's path refused and listed (R-BTN-138, §4) |
| 1-B-5 a mismatched delivery: refused or ignored | ignored and logged `forge-id-mismatch`, never matched by path; `unauthenticated` for CI tokens only (R-BTN-138) |
| 1-B-7, 1-B-8, 1-A-15 R-BTN-87 and R-BTN-56 unannotated | R-BTN-87: one machine key per Baton; R-BTN-56: the repository's promise, not checked across tenants |
| 1-B-9 move and App creation: operator or administrator | a move is the operator's provisioning plus the administrator's R-BTN-88 steps; App creation through the sink (R-BTN-136) |
| 1-B-10 the secret list inaccurate | every R-BTN-55 port and `Config` key is the tenant's; `BATON_SIGNING_KEY` named; the check App recast as the owners' (R-BTN-136) |
| 1-B-11, 1-A-13 Needs you, notification fields, private repositories | §14 annotated; GitLab `project.id`, Gitea `repository.id`/`owner.id` named; `GITHUB_TOKEN`/`GITLAB_TOKEN`/`GITEA_TOKEN` or `--forge-ids` |
| 1-B-12 frontmatter date; no owning ticket | `updated: 2026-10-18`; B-45 filed and named in the status line |
| 1-B-13, 1-B-14, 1-A-11 TENANCY_SPEC misquoted; origin vs authority; scheme | reworded: routed by host, every credential binds it; tenants differ by authority; multi-tenant `https` only |
| 1-B-15, 1-B-16 bearer secrets after a move; owner ids change on transfer | "unless R-BTN-88 moved it"; re-identify with `confirm` |
| 1-B-17 gates a local scenario cannot prove | G-BTN-131 split out, proved by a static check and a unit test of the Cloudflare shell |
| 1-B-18 Decisions placement | moved after the 2026-10-17 entries |
| 1-A-9 staging described two ways | §13 corrected: its own Worker, hostname and secrets |
| 1-A-10 account-wide usage on the dashboard | per-tenant counters only, and Workers Paid, when several tenants share (R-BTN-135) |
| 1-A-12 S-BTN-111 read like an oracle | refused exactly as a random key and a random session are |
| 1-A-14 "no cache" forbade sharing an issuer's key set | public, issuer-scoped caches excepted |

*(2026-10-18 — §3b tenancy, review gate round 2 on `b8f2735` (ids 2-A-n): every round-1
resolution verified in the text; 19 findings (3 blocking, 9 should-fix, 7 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 2-A-0 (blocking) the `operator` sink let an administrator key add administrators | the operator's store authenticates the tenant's account (login and second factor), never a Baton key; no Baton credential adds an administrator in any deployment (R-BTN-136) |
| 2-A-1 (blocking) "keeps its lease" against G-BTN-4 and the alarm | an unaccepted heartbeat still runs `timeout − 4 min`; lease upkeep has its own bucket and no cap; the reaping suspension withdrawn (R-BTN-135, §6.3) |
| 2-A-2 (blocking) the sink's commands did not exist; write-only secrets cannot be merged | `baton admin keys set --file` and `baton admin forge-secrets set --file`, whole values from a file the administrator keeps (R-BTN-136) |
| 2-A-3 a rename left `web_base` and `remote` on a takeable path | rewritten in the rename's transaction; a non-derived `remote` listed under Needs you (R-BTN-138) |
| 2-A-4 rename collisions contradicted the "passes" rule and had no way out | the token passes with the old path kept and the repository listed; an administrator's `confirm`ed path change, on any row, resolves it (R-BTN-138, §11) |
| 2-A-5 `job_workflow_ref` after a rename | checked against the token's own repository claim, matched by id (R-BTN-138) |
| 2-A-6 cookies ignore ports | tenants differ by host; two local hosts use two hostnames; S-BTN-111 runs on `127.0.0.1` and `127.0.0.2` (R-BTN-135) |
| 2-A-7 an issuer-keyed cache could be poisoned by one tenant's key-set URL | caches keyed by the exact URL fetched (R-BTN-135) |
| 2-A-8 signed junk escaped every limit | a failure bucket by origin, keyid and IP, refused in the Worker beyond 60 a minute; per-tenant caps count only verified requests (R-BTN-135, §3) |
| 2-A-9 the CLI and runner default to immediately.run's Baton | no default origin; exit 2 without one (R-BTN-137, S-BTN-112) |
| 2-A-10 B-45 built pieces of B-5 and B-9 | B-45 ships the naming helper; B-5 and B-9 gain the notice fields and the stream name |
| 2-A-11 seeds without ids | a seed may carry them; one without is path-only and listed (R-BTN-138) |
| 2-A-12, 2-A-13 the handshake's home, header and local id | `src/shell/`, `x-baton-tenant` stripped then set, absent refused, the local id `baton` (R-BTN-135) |
| 2-A-14 reaping suspended while capped | withdrawn with 2-A-1 |
| 2-A-15 id hygiene | `^[1-9][0-9]{0,19}$`, `Number.isSafeInteger`, duplicates `conflict` (R-BTN-138) |
| 2-A-16 the `baton_url` refusal's scope and claim | the home checkout only; reworded to what it stops (R-BTN-137) |
| 2-A-17 `repo identify` could record a squatter's ids | ids from the last path-verified token (`forge_ids_seen`), else the forge's full name and creation date confirmed (R-BTN-138, §4) |
| 2-A-18 the notice fields' null case and the courier's check | null in the path-only window; the courier refuses a foreign `origin` or a mismatched id (R-BTN-136) |

*(2026-10-18 — §3b tenancy, review gate round 3, the last, on `691a440` (ids 3-A-n): every
round-2 resolution verified in the text, two incomplete; 15 findings (1 blocking, 7
should-fix, 7 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 3-A-0 (blocking) the failure bucket let anyone on a shared IP lock a key out, heartbeats included | over its limit, the Worker verifies the bucket's requests against a cached public key and refuses only failures; a verifying request is never refused; S-BTN-114's flood comes from the runner's own IP (R-BTN-135, §3) |
| 3-A-1 upkeep bypassed storage caps; its bucket had no size | 30 a minute plus 30 per live claim; only the lease part is exempt, payloads over a cap dropped and logged `payload-dropped` (R-BTN-135) |
| 3-A-2 a rename let stale checkouts' `pre-push` miss the fence | `former_paths`, resolved by `?repo=` only (R-BTN-138, §4) |
| 3-A-3 `forge_ids_seen` could record a squatter's ids unseen | first and latest seen ids, a change listed; the CLI resolves by id and shows the forge's name and creation date; Baton stores explicit ids only if they equal the latest seen, else `conflict` (R-BTN-138) |
| 3-A-4 "no default origin" left out `baton_url`; docs not listed | `baton repo *` in a checkout takes `baton_url`; the runbook and README added to B-45 (R-BTN-137) |
| 3-A-5 "logged" undefined; Worker logs are the operator's | renames, path changes and identifies are `admin` events with `detail.action`, mismatches `discrepancy` events; `tenant-mismatch` an operator log (R-BTN-135, R-BTN-138) |
| 3-A-6 a held rename kept clones on a takeable path; retired rows held paths | retired rows' paths tombstoned; a held rename holds the repository's tickets (`rename-held`) until resolved; the `confirm`ed path change applies the rewrite (R-BTN-138) |
| 3-A-7 B-9's dependency on B-45 | `depends_on: [B-2, B-45]` |
| nits | the scope list's fields; local origins `localhost` and `127.0.0.1`; the local shell runs the same checks; the courier refuses a null `forge_repo_id`; the per-IP rule as a Workers rate-limit binding; §11's `conflict` names forge ids; the alarm waits for `tenant_id` |

*(2026-10-18 — §3b tenancy, a fourth look at round 3's fixes, on `b69bc0c` (ids 4-A-n),
asked for by the owner after the gate's three rounds: 14 findings (1 blocking, 11 should-fix,
2 nit). Where a round-3 mechanism drew the finding, the fix removes mechanism rather than
adding it. Resolved:)*

| Finding | Resolution |
|---|---|
| 4-A-0 (blocking) dropping an upkeep call's payload broke entry requirements, children and gates, invisibly | withdrawn: no cap refuses an upkeep call or drops anything it carries; upkeep is bounded by its own bucket and item caps, the storage cost stated (R-BTN-135) |
| 4-A-1 the object's full check of a forwarded request unstated | the Worker's check is a filter, never an authorization; the object verifies every forwarded request in full, a revoked key included (R-BTN-135) |
| 4-A-2 random keyids bypassed the failure bucket | a second bucket by origin and IP across ids; over either, the Worker checks against a snapshot of the whole credential set, so a random id costs no fetch (R-BTN-135) |
| 4-A-3 bearer credentials had no failure check | buckets keyed by a bearer's `<id>`; the snapshot carries bearer hashes (R-BTN-135) |
| 4-A-4 the negative cache refused a newly granted key | the snapshot is re-fetched at most every 5 seconds on a miss (R-BTN-135) |
| 4-A-5 rings and shared cloud keys filled the upkeep bucket | +1 per live session; ring-triggered heartbeats coalesced to one every 10 seconds; the bound cited as one claim per worker (R-BTN-135) |
| 4-A-6 `payload-dropped` undefined | withdrawn with 4-A-0 |
| 4-A-7 former paths missed the fence for code repositories; several matches | `?repo=` and `repos:` match current and former paths, for the fence only, several matches failing safe (R-BTN-138) |
| 4-A-8 the tombstone against the validator, import and existing rows; unbounded former paths | the validator and import accept a tombstone only on a retired row; the migration rewrites retired rows; a retired `web_base` unread; the latest 10 former paths (R-BTN-138, §4) |
| 4-A-9 `rename-held` was no rule, `forbidden` killed leases, active claims kept the old path | §7.2 rule 13 at a claim only, `not-eligible`, over the home and `repos:`; active claims sent a `requested` release; a later non-colliding rename clears it (R-BTN-138) |
| 4-A-10 `repo identify` could deadlock on a squatter's or another repository's ids; the CLI could not read seen ids | differing ids refused `conflict` naming the seen ids, which the CLI resolves by id and shows; the choice sent with `confirm: true`; a `confirm`ed path change clears them (R-BTN-138) |
| 4-A-11 a mismatch as a `discrepancy` broke R-BTN-85; a row per refused request | no event per mismatch: a counter in `forge_ids_seen`, updated at most once a minute, listed under Needs you; the actor of a rename event is `sync` (R-BTN-138) |
| 4-A-12 `baton repo *` read `baton_url` from the working tree | read at the synced commit; a runner's or worker's sync skipped when it differs from the runner's origin (R-BTN-137) |
| 4-A-13 S-BTN-113 contradicted the tombstone; new behaviours untested; G-BTN-134's wording | S-BTN-113 rewritten with a live collision, the fence by former path, `rename-held` and identify's `conflict`; S-BTN-114 adds random ids, bearer junk and rings; G-BTN-134 reworded |

*(2026-10-18 — §10.7 hardening, review gate round 1 on `88c4639` (ids 1-A-n security, 1-B-n
consistency): 44 findings (3 blocking, 31 should-fix, 10 nit). Resolved:)*

| Finding | Resolution |
|---|---|
| 1-A-0 (blocking) a real off-branch commit as Baton's head froze the board and stalled every runner | the sync checks the head is reachable from the default branch; `head_unfounded` covers absent and off-branch heads; step 4's "post nothing" only for a founded head; S-BTN-121 adds a real branch commit (R-BTN-147) |
| 1-B-0 (blocking) §4 not amended | a dated §4 block: the columns, `tainted_branches`, `open_world_bars`, `login_codes`; new events as `admin` events; the nonce TTL 11 minutes |
| 1-B-1 (blocking) the verdict leg needed undefined architecture | `check_command` on the leg; R-BTN-107's provider gains `exec(argv, {cwd, timeout_s}) → {status}`; 0 → success, other → failure, timeout → neutral; the cost stated (R-BTN-153) |
| 1-A-1 rollback and the never-expiring cache | no strict ancestor of the newest verified sha; the cache only for a held rewrite's head, flushed on acceptance; the runner's own ref (R-BTN-143) |
| 1-A-2 the last editor laundered markers | author and every editor trusted; unedited only where editors are unknown (R-BTN-139) |
| 1-A-3 a transient permission failure dropped every verdict | an erroring read aborts the run; only a known lack of scope degrades; per-run cache; GitLab `read_api` (R-BTN-139) |
| 1-A-4 former paths and spelling in `code_repos` | entries resolved to ids; consent by id through `code-repo-consents`; former paths mapped by id, fence only; a PR's base id must be listed (R-BTN-140) |
| 1-A-5 a tainted branch's PR could merge | `tainted_branches`; station functions ignore them; `merge` and `fix` refuse them (R-BTN-148) |
| 1-A-6 `misdeclared` punished honest drift and enabled griefing | only for commit-determined sources at the declared CLI, settled by the sync key, CI or the claimant itself; another machine key's post ends `stale-board` with no penalty; the bar per ticket (R-BTN-148) |
| 1-A-7 another repository's grant switched A's flags off | span counts only repositories whose course the key declared in the last 7 days (R-BTN-146) |
| 1-A-8 observation takeover barred the honest sync | renewal; being voided is not lapsing; the bar never applies to the sync key or CI (R-BTN-150) |
| 1-A-9 caps let one credential lock a repository; heartbeat contradiction | writes charged per credential first, owners, administrators, sync key and CI never refused by the total; held rows per credential; a first heartbeat is not upkeep; 200 sessions a day (R-BTN-149) |
| 1-A-10 an agent could shim the verdict command | the command runs first in a fresh sandbox at `check_sha`; `exit_status: 0` required; `min_worker_version` (R-BTN-153) |
| 1-A-11 one check App across repositories | `courier add --delivers forge-check` refuses an App installed on others' repositories (R-BTN-153) |
| 1-A-12 two truths on MCP holds | R-BTN-129 matches by field and value, four actions; §10.1's row; S-BTN-101 extended |
| 1-A-13, 1-B-2 the old sign-in flow and missing rows | R-BTN-57's link flow withdrawn, the token path removed; §11 note and new rows; §4 `login_codes` |
| 1-A-14 sign-in lockout by address; the cookie jar | drop the oldest row, never refuse; `--trusted-proxy`; 4-hour sessions; destructive dashboard actions confirmed by a signed code; the cost stated (R-BTN-155) |
| 1-A-15 bearers in clear on a LAN | a non-loopback `http` origin refuses every bearer credential (R-BTN-158) |
| 1-A-16 custom station functions | the CLI drops untrusted markers and outputs whatever function runs; docs' `locate` named for B-46 (R-BTN-139) |
| 1-A-17 to 1-A-24 nits | re-key signed by the name's credential; reserved `credential:` names; exact tag and pid start time; the `asks` cost stated; shared-bot warning; check tickets dropped without ids; the machine-key-only rewrite cost stated; GitLab trigger variables |
| 1-B-3 §10.1 stale | the administrator, MCP and owner rows corrected |
| 1-B-4 §6.5 and §6.10 | `off-branch` and `misdeclared` added; `misdeclared` counts, `off-branch` does not |
| 1-B-5 §7.1 | a dated note; markers trusted only |
| 1-B-6 §14 | a dated note listing the new Needs-you items |
| 1-B-7 settings unbuildable | R-BTN-66 table rows; `trigger_workflows` the administrator's; the consent route |
| 1-B-8 commands without actions | `owner.bars.follow`, `admin.sessions.revoke` (destructive), `ui.logout`, `admin.confirm`, `owner.grants.list`, `owner.grants.flags`, `owner.code-repo.consent`, with routes |
| 1-B-9 `rank_advice`/`rank_launch` undefined | course-file keys naming R-BTN-108 schema ids; absent, advice and launch dropped (R-BTN-152) |
| 1-B-10 `rank.mjs` in the runner's process | runs in a child (R-BTN-144, R-BTN-98 noted) |
| 1-B-11 the masking window and key blocks | hold from `BEGIN` to `END` or 16 KB; token alphabets given (R-BTN-144) |
| 1-B-12 amended targets without notes | R-BTN-98, R-BTN-137, R-BTN-138, §6.3, §6.4, §6.8, §8 noted; §10.4's URI sentence flipped |
| 1-B-13 S-BTN-123 against R-BTN-114 | the ticket restarts on the new head |
| 1-B-14 sibling tickets | B-5, B-9 and B-25 amended; B-46 names B-25, the server pieces and the migration |
| 1-B-15 to 1-B-18 nits | R-BTN-67's "silently"; R-BTN-129 by value, `forbidden` without a rule; the §2k 2-A-1 row qualified and noted; `claim.sh`'s list, G-BTN-145's GitLab sources, editors, ids, the clone credential |

*(2026-10-18 — §10.7 hardening, review gate round 2 on `589d7d8` (ids 2-A-n, 2-B-n): every
round-1 resolution checked in the text, three not holding; 21 findings (3 blocking, 11
should-fix, 7 nit). Where a round-1 mechanism drew the finding, the fix replaces it with a
simpler rule. Resolved:)*

| Finding | Resolution |
|---|---|
| 2-A-0 (blocking) span by declared courses let a key sync every repository it held a grant for, unflagged | withdrawn: a grant to a key already granted elsewhere is pending until the key's holder accepts it (`runner.grant.accept`); span counts active grants; at span 2 or more the flags bind on every repository, the first included and keys that never heartbeat (R-BTN-146) |
| 2-A-1 (blocking) the no-rollback watermark refused honest claims | withdrawn; older default-branch code until the next honest sync is a stated cost (R-BTN-143) |
| 2-A-2 (blocking) renewal let a holder keep a number for ever | a 30-minute total life; the sync key or CI voids another's number at once; held past 15 minutes is listed (R-BTN-150) |
| 2-A-3 misdeclaration needed facts no post carried, and a fake `cli` dodged it | the post names `source: {kind, cli}`; a `declared.cli` other than the last accepted post's is `invalid-params` (R-BTN-148, §7.1, §11) |
| 2-A-4 an editors read error dropped verdicts | it aborts the run, as a permission read does; the GitLab/Gitea wording fixed; member lists read once per run (R-BTN-139) |
| 2-A-5 eviction still locked the administrator out | a row whose cookie has polled is never evicted; the cost stated; the CLI reports evictions; bursts listed (R-BTN-155) |
| 2-A-6 the bearer refusal keyed on the origin | keyed on the connection's peer: neither loopback nor the trusted proxy (R-BTN-158) |
| 2-A-7 `exec` only for cloud sessions | `process` mode runs the command itself in a fresh clone at `check_sha`; `attached` takes no verdict leg; an `advance` into success needs `exit_status` too (R-BTN-153) |
| 2-A-8 confirmation codes underspecified | 8 characters, two minutes, single use, bound to session, action and parameters, `action_confirmations`; the three `/v1/ui` routes answer `202 {confirm_code}`; the CLI prints the action first (R-BTN-155, §4, §11) |
| 2-A-9 R-BTN-135 still said heartbeats were never refused | a first heartbeat is not upkeep there too; the 201st is `quota` (R-BTN-135, R-BTN-149) |
| 2-A-10 the runner cannot know `merge` and `fix` | it refuses to check out or push a tainted branch for any leg (R-BTN-148) |
| 2-A-11 consent judged only at addition | judged at every use; withdrawable (R-BTN-140) |
| 2-B-0 §4 and prose disagreed, with gaps | `login_codes` in the flow; `end_reason`; `worker_grants.accepted_at`, `write_budgets`, `observation_lapses`, `action_confirmations` |
| 2-B-1, 2-B-2, 2-A-12 to 2-A-15 nits | `head_unfounded` in B-46, R-BTN-11's note and G-BTN-141; R-BTN-86's body; "selected repositories" and a re-check per delivery; one fetch by sha before declaring a head absent; `check_sha` must be the change's `refs/heads/*` head; GitLab and Gitea member lists once per run |

*(2026-10-18 — §10.7 hardening, review gate round 3, the last, on `1bdbf73` (ids 3-A-n): round
2's resolutions checked, most holding; 21 findings (1 blocking, 10 should-fix, 10 nit).
Resolved:)*

| Finding | Resolution |
|---|---|
| 3-A-0 (blocking) refusing a `declared.cli` other than the last post's refused honest claims during upgrades | any `cli` is accepted; the penalty only when the settling post's `cli` equals it; otherwise `stale-board` with the per-ticket bar and the taint (R-BTN-148) |
| 3-A-1 the first grant needed no acceptance | every fingerprint grant is pending until `runner.grant.accept`; a token registration is acceptance; `runner.grant.decline`; `accept-grant` prints what loses sync and needs `--confirm` (R-BTN-146) |
| 3-A-2 `accepted_at` undefined | set at first activation, cleared on a re-grant after a revoke, backfilled by the migration; revoking others never activates; the deploy-time cost stated, with `baton owner grants list` (R-BTN-146, B-46) |
| 3-A-3 `process`-mode `exec` contradicted R-BTN-114 | withdrawn: verdict legs keep `isolation: session`, credentials withheld (R-BTN-153) |
| 3-A-4 the branch check had no data | `check.head_ref` (a filter field, §4); a moved branch ends `stale-board` (R-BTN-153) |
| 3-A-5 the sync lacked the owner state its trust needs | the observation response carries `trusted_identities`, effective `code_repos` and `tainted_branches`; §7.1 step 2 fetches the registered branch (§11, §7.1) |
| 3-A-6 the sync key and CI could void each other in a loop | the immediate void never applies between them, and a CI identity is one credential (R-BTN-150) |
| 3-A-7 eviction with every row polled | the oldest polled row with no bound code is dropped (R-BTN-155) |
| 3-A-8 confirmation covered three actions | also hold lifts and expedite, completion confirm and release, adoptions and release messages; the `sk-` dependency stated (R-BTN-155) |
| 3-A-9 the tickets lagged | B-46 lists rounds 2 and 3's additions and the full migration; B-5 the session floor, `head_ref` and `exit_status` on `advance` |
| 3-A-10 round 2 had no scenarios | S-BTN-121 to S-BTN-125 extended |
| nits | the 30-minute age voids only at another's request and is not a lapse, `observation_issued_at`, the machine-key-only cost; flags kept for a later rise; S-BTN-120's code; §11 pending, `confirm_span`, `withdraw`, `dry_run`; the `exec` bullet restructured; the tainted `pre-push` hook cooperative; §14's list; the sync's per-credential budget exempt; rule 13's wording; the Cloudflare host refuses bearers on plain `http` |

The gate's three rounds are done. Round 3's fixes have not been reviewed again.

*(2026-10-18 — owner-requested reviews of the last unreviewed fixes: §3b's round-4 fixes
(`27e579e`, ids 5-A-n) and §10.7's round-3 fixes (`30de996`, ids 4-A-n), read against the
renumbered, merged text. Neither found anything blocking: §3b 9 should-fix and 6 nit, §10.7 11
should-fix and 7 nit. Both confirmed the tenancy claim holds. Resolved:)*

| Finding | Resolution |
|---|---|
| 5-A-0 a former path let one repository refuse another's pushes | a former path matches only while no live repository holds it; `former_paths_remove` (R-BTN-138) |
| 5-A-1 identify stored a squatter's ids when first and latest differed | unconfirmed only when none were seen or the ids equal both; else `conflict` naming both (R-BTN-138) |
| 5-A-2 unregistered code repositories had no former paths | `code_repos` entries keep their own, updated from id-matched deliveries, matched by id once stored (R-BTN-138, R-BTN-140) |
| 5-A-3 renames detected only from CI tokens | an id-matched delivery or notification with a new path is a rename too (R-BTN-138) |
| 5-A-4, 5-A-5 rings could fill the upkeep bucket and delay Cancel | a bucket per live claim, which idle sessions never spend; `rate-limited`; the sidecar coalesces; `release` rings never coalesced (R-BTN-135) |
| 5-A-6, 5-A-7 failure buckets for sessions and CI; refusing fresh credentials | sessions and sign-ins carry an id; CI tokens, deliveries and notifications are their own filter; a miss forwarded within one a second while the re-fetch waits (R-BTN-135) |
| 5-A-8 identify's row and error body | §11's row amended; `conflict` carries `seen: {first, latest}` |
| 5-A-9 to 5-A-14 nits | §3's note; §14's list; the snapshot keyed by origin and named among the deployment's; `baton_url` precedence and the mirror, init and spool; the last 5 mismatching ids, written at most once a minute; G-BTN-133's wording |
| 4-A-0, 4-A-1, 4-A-15 settlement outcomes ambiguous; honest issue edits tainted | one table: only markdown at the claim's sha bars and taints; issue or row drift, a later sha and another machine key's post do neither; the cost stated (R-BTN-148) |
| 4-A-2, 4-A-13, 4-A-17 `head_ref` never reached the runner; no want on a moved head | `check_head_ref` in the claim response, `head_ref` in the board note and B-5; a sync want (R-BTN-153) |
| 4-A-3, 4-A-4 §11 listed three confirmed routes; Stop needed a terminal | §11 lists every confirmed route; setting a hold, Stop and `release` messages are not confirmed; §14 says what the dashboard does alone (R-BTN-155) |
| 4-A-5 the plain-`http` refusal could not stop the leak | clients refuse to send bearers over non-loopback `http`; the server detects and revokes (R-BTN-158) |
| 4-A-6, 4-A-7 getting started left the machine idle; accept needed a worker secret | the example shows `accept-grant`; heartbeats carry `pending_grants`; accept and decline are machine-key-only, with §11 rows (R-BTN-146, §10.6) |
| 4-A-8 API-key and migrated grants would stay pending | active at creation, and B-8's migration writes `accepted_at` (R-BTN-146, B-8) |
| 4-A-9, 4-A-10 an agent could decline another repository's grant; a declined first grant fixed the hostname | decline returns an active grant to pending, logged and listed; the hostname binds at first acceptance; the acceptance cost restated (R-BTN-146) |
| 4-A-11, 4-A-12, 4-A-14, 4-A-16 nits | no check passes on any runner until a provider gains `exec`, which B-5 adds; scenarios, gates and B-25 extended; the two-machine-key livelock stated; R-BTN-58's and R-BTN-102's banners |

These fixes are not reviewed again.

*(2026-10-22 — the owner commissioned an adversarial review of the ontology design, as tickets
B-104 and B-105 then stood after iterations 1–5 of the changelog, from a fresh session: 36
findings, 12 blocking. The review is kept verbatim in
`docs/review/opus-ontology-review-2026-10-22.mdx`. Resolved in the rework that wrote §5.9 and
§6.10; B means blocking:)*

| Finding | Resolution |
|---|---|
| 1 B — N3 still the deliverable | ASP-Core-2 is the language (R-BTN-175); N3 rejected (Decisions in full) |
| 2 B — nobody builds the clingo check | the conformance suite is R-BTN-175's, extended by R-BTN-177; built under B-104 |
| 3 the fragment named three ways | one sentence, in R-BTN-175 |
| 4 a duplicated block | the drafts' text; not carried over |
| 5 "variables in predicate positions" | first-order, variables in argument positions (R-BTN-175's terms) |
| 6 B — which cycles are refused | only cycles through negation, on the predicate graph; positive recursion allowed (R-BTN-175) |
| 7 B — a 50–100-line runtime cannot join | a bounded general evaluator, about 300–400 lines, parsing in core (R-BTN-175; owner) |
| 8 B — fractions against clingo's integers | `int` atoms only, fixed point (`remaining_permille`); non-integers form no atom (R-BTN-176) |
| 9 type mismatch in comparisons | variables typed by their binding literal; ill-typed comparisons refused (R-BTN-175, R-BTN-176) |
| 10 names are not ASP constants | quoted-string constants, `V_` variables, no gringo-only syntax; ternary typed field atoms (R-BTN-175, R-BTN-176) |
| 11 B — hysteresis needs state | `choice_last` read as `was_demoted`, an input fact (R-BTN-177; owner) |
| 12 B — the examples do not flip; soft against hard | guards soft, availability hard; the examples reordered (R-BTN-177; S-BTN-147, -148) |
| 13 the capability gate confused with provider state | `has(K)` and `blocked(R)` through `meters`, two hard filters (R-BTN-177) |
| 14 optimal answer sets flake | a strict order, a unique optimum, `route/2` compared by projection (R-BTN-177) |
| 15 clingo accepts more than ASP-Core-2 | the strict-syntax test; `#show` kept out of the translation (R-BTN-175) |
| 16 B — readings belong to instances | instance-keyed atoms through `usable`, one speaking reading (R-BTN-176) |
| 17 B — no schema composition; immutable schemas | `x-baton-base` refinement, checked at registration; `refines/2` (R-BTN-76, R-BTN-176) |
| 18 nested fields, arrays, booleans, null, partial readings | dotted paths, and the list of what forms no atom (R-BTN-176) |
| 19 an administrator step; credential to resource | stated: an administrator registers, the repository supplies `meters` (R-BTN-176, R-BTN-177) |
| 20 a lapsed reading flips the decision | `unknown(I)`; fails open as R-BTN-76 does; the fail-closed idiom (R-BTN-176; S-BTN-148) |
| 21 malicious instruments | administrators and instrument keys by default, `atoms_from: any` opt-in, advice only (R-BTN-176; owner) |
| 22 B — the grant intersected after the closure | the closure of (declared ∩ grant) (R-BTN-174; S-BTN-142) |
| 23 B — rule heads unrestricted | gate-stratum rules 1–2, checked on the maximal input (R-BTN-175) |
| 24 B — no evaluation bounds | counted bounds, the maximal-input check, stored results, alarm batches (R-BTN-174, R-BTN-175) |
| 25 readings feeding gates | gate-stratum rule 3 (R-BTN-175; S-BTN-152) |
| 26 which snapshot governs | the default branch's head, the previous program kept on refusal, the stored set re-read at each advance (R-BTN-174) |
| 27 advice text as an injection path | identifiers only; text composed by the dashboard (R-BTN-177) |
| 28 B — a derived route strips its credential | `via` and the available alternatives' credentials kept (R-BTN-144, R-BTN-174, R-BTN-177) |
| 29 `credential:` pattern; types undeclared | environment-variable names; `derived` types declared in the course file (R-BTN-121) |
| 30 bindings cannot narrow; bindings against preferences | default negation, the built-in idiom (R-BTN-175; owner) |
| 31 two override granularities, no `id` | every entry has an `id`; retract and replace by id; the sync merges (R-BTN-174, R-BTN-175) |
| 32 the why-not algorithm unspecified | the canonical choice (R-BTN-174; S-BTN-144) |
| 33 an override cannot be detected | `BATON_ROUTE`, `route` on advance and end, `advice-overridden` (R-BTN-177) |
| 34 pins encode an invariant; null advice | invariants are `exclude_when` or barred tags; no advice leaves the leg's own default (R-BTN-177) |
| 35 a second naming scheme (`model_name`) | a binding's value is the capability string (R-BTN-175) |
| 36 advice goes stale in long legs | a snapshot per leg, not refreshed (R-BTN-177) |

*(2026-10-22, round 2 — a second fresh reviewer read §5.9 and §6.10 as first written, with every
rule they touch, against the code: 4 blocking, 15 should-fix, 8 nits. Resolved in the rewrite
that followed:)*

| Finding | Resolution |
|---|---|
| 1 B — `derived(K) :- target(K), not safe.` escapes the maximal-input check | no negated literal in the gate stratum names a predicate depending on `holds`; derived atoms must match their type's `values`; G-BTN-159 restated (R-BTN-175; S-BTN-140) |
| 2 B — the encoding's predicates are not reserved | reserved, stratified together with the program, and never named by guards (R-BTN-175, R-BTN-177; S-BTN-152) |
| 3 B — the built-in is refused where its types are undeclared | the ontology is opt-in through `.baton/ontology.json`, naming a built-in by version (R-BTN-174; S-BTN-143) |
| 4 B — `model` and `credential` fields put provider words in core | an alternative lists the capabilities it `needs`; R-BTN-50's table gains the ontology's words (R-BTN-177, R-BTN-50) |
| 5 hysteresis shared across runners | `choice_last` keyed by runner (R-BTN-177; S-BTN-148) |
| 6 `atoms_from` bypassed through `state` and `blocked` | the choice state and `blocked` hear permitted sources only; `unknown(I)` folded into `state` (R-BTN-176; S-BTN-149) |
| 7 one repository's program can exhaust the tenant's object | gate bounds 200,000 matches and 5,000 atoms, the choice bound 50,000, and an alarm budget per turn (R-BTN-174, R-BTN-175) |
| 8 rule 4 reads a stale set | stale sets are re-evaluated in the claim's or advance's transaction; fleet counts recounted once (R-BTN-174; S-BTN-146) |
| 9 `via` depends on evaluation order | every holding some derivation rests on, from the fired instances (R-BTN-174; S-BTN-145) |
| 10 preflight unspecified | R-BTN-121's `check`, and R-BTN-126's `released:blocked` on a holding in `via`, not a failed attempt (R-BTN-174, R-BTN-126) |
| 11 grants cannot narrow derived capabilities | stated: grants bound holdings; the CLI warns, and derived capabilities are shown beside the grant (R-BTN-174) |
| 12 the program depends on the CLI's version | the built-in is versioned and named by the file; a published version never changes (R-BTN-174) |
| 13 courses and the ontology judged in no stated order | a three-step joint acceptance; courses must agree on `derived` (R-BTN-174) |
| 14 merging choices under-specified | one id namespace; a reused choice id replaces the whole choice; the merged program is capped too (R-BTN-174, R-BTN-175) |
| 15 types of mixed positions undefined | per-position inference; a mixed position refused (R-BTN-175) |
| 16 the clingo assertions are vacuous or wrong | `run(text, 0, …)`; `Models.More` `"no"`; the none-available case `SATISFIABLE`; both clingo info notices allowed (R-BTN-175, R-BTN-177) |
| 17 refinement checking absent from resource registration | registration checks a `std:`-only `x-baton-base` with R-BTN-108's check; `refines` defined over the base chain (R-BTN-76, R-BTN-176) |
| 18 the advice is stored nowhere; routes unvalidated | `claim_legs.advice_json` and `route_json`; an invalid route is dropped and logged `route-invalid`, never refused (R-BTN-177; S-BTN-153) |
| 19 why-not reads derivations that do not exist | computed over the maximal evaluation's fired instances, as a least fixpoint (R-BTN-174; S-BTN-144) |
| 20–27 nits | negative integer constants admitted; `not` and variable spelling constrained; `runner:` capabilities in H; sourced courses' choices; empty `needs`; scenario setups stated; `isEligible`'s vendored change and `choice_last` cleanup; the architecture page records that the ontology is data core interprets |

*(2026-10-22, round 3 — a third fresh reviewer read the rewritten §5.9 and §6.10 and ran clingo
on the encoding, which it confirmed valid and equal to first-match: 1 blocking, 15 should-fix,
8 nits. Resolved:)*

| Finding | Resolution |
|---|---|
| 1 B — why-not's min-of-unions fixpoint can oscillate | replaced by the canonical proof the deterministic evaluator records, one row per atom (R-BTN-174; S-BTN-144) |
| 2 `via` follows cycles and depends on "fires" | replaced by the canonical proof's holdings; the choice's alternatives supply other routes (R-BTN-174, R-BTN-177; S-BTN-145) |
| 3 match bounds are not monotone in H | the evaluator, rounds and a match are defined; runtime gate evaluations get twice validation's budget (R-BTN-175) |
| 4 claim-time resolution against R-BTN-63 | resolved at each `advance` that starts a leg; stored in `claim_legs.choices_json` (R-BTN-177; S-BTN-153) |
| 5 a dead choice credential cannot block | R-BTN-126 accepts a credential a choice gave the leg (R-BTN-126, R-BTN-177) |
| 6 credentials under `limit` or `none-available` | none from the choice; a default that needs a credential lists it in `requires` (R-BTN-177) |
| 7 acceptance order contradicts itself and R-BTN-69 | three ordered steps; R-BTN-69 cites the program in force after the post (R-BTN-174; S-BTN-155) |
| 8 a refused program can leave an invalid one in force | the previous program survives only if it still validates, else none (R-BTN-174; S-BTN-146) |
| 9 no wire field, digest or layout entry | §4.4's `ontology` field; core computes the RFC 8785 digest; R-BTN-51 lists the file; merge scenario S-BTN-155 |
| 10 why-not has no answer shape | `not-derived` with `needs`, `missing` and `chain`; the fleet form; the direct declaration offered (§6.2, R-BTN-174) |
| 11 `instances_json` unbounded | `ontology_proofs`, one small row per atom, at most 5,000 (§13) |
| 12 one repository can load the tenant | a program change at most every 5 minutes; a round-robin alarm budget; only changed rows written; 256 derived capabilities; re-evaluation committed apart from the claim (R-BTN-174) |
| 13 core both reads and never reads `detail` | R-BTN-50 and R-BTN-108 name the one exception (R-BTN-176) |
| 14 a newer reading without `detail` erases the fields | the field reading is the latest that carries a `detail` (R-BTN-176; S-BTN-148) |
| 15 the model and vendored `isEligible` | both receive H ∪ D(H) as the runner's capabilities; the evaluation sits outside them (R-BTN-174) |
| 16 advice reads stale sets | stated as advice that may lag; only rule 4 is guaranteed fresh (R-BTN-174) |
| 17–24 nits | every string constant held in the maximal evaluation; S-BTN-140's impossible case dropped; empty warnings filtered; `meters/2` reserved in shape; needs checked against types and R-BTN-144; hysteresis's per-runner claim narrowed; `choices_json` and the new variables' aliases; retention of `choice_last` and `runner_derived`, the fleet view's derived capabilities, the condition's closing, no gate re-derivation in a choice, ground facts, and §5.8's sentence |

*(2026-10-22, round 4 — a fourth fresh reviewer, who confirmed the fragment, the evaluator's
rounds, the canonical proof's well-foundedness and the choice encoding against clingo: 2
blocking, 12 should-fix, 6 nits. Resolved:)*

| Finding | Resolution |
|---|---|
| 1 B — course files can derive past a grant | the owner: a capability states ability, not authority; derivation stays past the grant (R-BTN-174; Decisions in full) |
| 2 B — R-BTN-144 contradicts credential delivery | the owner: no credential scoping; the ontology and choices pass none; provider keys are `key:` labels (R-BTN-144 unchanged, R-BTN-174, R-BTN-177; S-BTN-145) |
| 3 joint acceptance can leave a course with an undefined choice | the program and course files' ontology parts are accepted or refused as one unit, consistent by construction; the 5-minute window defers the whole unit (R-BTN-174; S-BTN-155) |
| 4 course changes do not re-validate the program | a course's ontology part belongs to the unit; changing derived types or `values` marks sets stale (R-BTN-174) |
| 5 R-BTN-126 contradicts itself | its Invalid bullet defers to the `capability` bullet (R-BTN-126) |
| 6 the canonical proof depends on open orders | fact, `holds`, merge-position and later-round orders fixed (R-BTN-174, R-BTN-175) |
| 7 guards over gate predicates undefined | guards may not depend on `holds` or `derived`; holding-independent predicates evaluated at acceptance (R-BTN-176) |
| 8 the no-advice fallback forces `requires` | moot: choices pass no credential |
| 9 the alarm budget cannot fit an evaluation; claims unbounded | evaluations always finish and the turn stops starting new ones; at most two re-evaluations per request (R-BTN-174; S-BTN-146) |
| 10 runtime H unbounded | the input is H restricted to the program's constants (R-BTN-175; S-BTN-146) |
| 11 why-not's chain exponential | a deduplicated, linear walk; `not-derivable` when no proof exists (R-BTN-174) |
| 12 `atoms_from` per resource, atoms per instance | a runner's reading is permitted only when every resource the instance serves admits runners (R-BTN-176) |
| 13 derived needs get no credentials | moot |
| 14 S-BTN-154 tests the claim | it tests the advance |
| 15–20 nits | the suite in vitest's Node project and the `Models.Optimal` cast; "one optimal answer set" with the encoding; a strict-syntax parser written from the grammar; path and instance-id length; S-BTN-148 aligned; merge edge cases fail the sync; guard rules obey the limits; the condition closes on acceptance; a route against `null` advice; declared-or-derived rules; `not-derivable` |

*(2026-10-22, round 5 — a fifth fresh reviewer confirmed the formal core against clingo: the
fragment, stratification, the gate stratum's monotonicity, the canonical proof and the choice
encoding's equivalence with first-match. It found 1 blocking, 17 should-fix and 7 nits, all in
bounds and seams. **Not yet resolved**, and B-104 and B-105 are back in review until they are:)*

| Finding | Status |
|---|---|
| 1 B — acceptance-time evaluation of holding-independent predicates (and constraints) is unbounded | open |
| 2 an absent `ontology` field: "none" (§4.4) or "the one in force" (R-BTN-174) | open |
| 3 R-BTN-126 checks a dead holding against a proof only the maximal evaluation stores; derived needs are not admissible refs | open |
| 4 a dead holding without a real `check` is re-declared at the next heartbeat | open |
| 5 a choice may need a `credential:` capability the leg will not receive | open |
| 6 R-BTN-126 re-evaluates every repository's set in one end | open |
| 7 candidate selection reads stale sets; "rule 4 never reads a stale set" overstated | open |
| 8 resource blocks attach to the leg, not the alternative; runner-scope resources cannot steer a choice under `atoms_from: admin` | open |
| 9 the 5-minute window loses a revert to the program in force, and has no store for waiting course files | open |
| 10 removing a course is outside unit acceptance | open |
| 11 merge errors fail the whole sync instead of refusing the unit | open |
| 12 proof and derived-row writes escape the write budgets | open |
| 13 the match budgets are not checked against R-BTN-87's latency budgets | open |
| 14 rule 4 is `gatesFor` (src/core/gates.ts), which re-checks the grant per need, not `isEligible` | open (verified) |
| 15 S-BTN-142 and S-BTN-146 rely on heartbeats §11.1 refuses | open |
| 16 S-BTN-143's block cannot appear while a direct declarer is live | open |
| 17 repository rules over core atoms, and `meters`, can depend on `holds` at choice time | open |
| 18 derived-set bookkeeping for non-live runners, empty sets and `runner_derived_state` | open |
| 19–25 nits | open: R-BTN-120's prose, S-BTN-146's wording and test seam, S-BTN-144's fact order, the runtime bound's sufficiency, route-file lifetime, a program change mid-claim, S-BTN-148's lapse |

*(2026-10-22, round 6 — a review on a different model (Fable 5.1) read the sections against the
new resident context (values 12) and round 5's open list: 1 blocking, 9 should-fix, 1
simplify, 6 nits. It reclassified eight of round 5's findings. Resolved in the rewrite that
followed, which also closed round 5; dispositions below:)*

| Finding | Status |
|---|---|
| 1 B — lazy derived sets cannot meet the freshness bound (advice no older than the reader's last accepted write); flapping declarations saturate the alarm | open; proposed fix: evaluate D(H) in the transaction of the write that changes H; this drops the per-request cap, the `prefer` pass-over and `runner_derived_state` |
| 2 "one alarm cycle" is not what the alarm budget delivers after a program change | open |
| 3 "only the guard rules" omits repository rules over core atoms (`ocg_peak`, `near_limit`) | open (same seam as round 5 #17) |
| 4 a leg's `choices` uncapped: 500 choices × 50,000 matches per advance | open |
| 5 refinement check placed in core, which holds no `std:` schema bodies | open; proposed: the CLI checks, core stores chain names |
| 6 `derived` in course files breaks sourced courses; `values` ambiguous across courses | open; proposed: declare derived types in `ontology.json` |
| 7 the fleet view's `ETag` omits `runner_derived` changes | open |
| 8 a dead choice holding costs a whole claim | open; proposed: advice carries the ranked available list, and the leg falls through |
| 9 `BATON_ROUTE` is agent-written, with no size or parse rule | open |
| 10 §11.1 refuses a heartbeat declaring an ungranted capability, which polices a statement | open; proposed: delete the refusal (resolves round 5 #15) |
| 11 Simplify — `ontology_proofs` stores what a read can recompute | open |
| 12–17 nits | open: the same-digest sentence; `exclude_when` called an invariant; `gatesFor`, not `isEligible`; untyped positions and reflexive "depends on"; S-BTN-147 and S-BTN-153 set-ups; R-BTN-120's prose |
| Round 5 re-read | #3 cut (any declared capability is an admissible `ref`); #4 a runner-side nit; #5 smaller (refuse a `credential:` need `requires` does not name); #7 subsumed by 1; #8 a runner's own `runner`-scope instance always permitted; #12 halved by 11; #15 resolved by 10; the rest stand |

*(Dispositions of rounds 5 and 6, 2026-10-22, in the rewrite after the owner's decision on
derived types:)*

| Finding | Resolution |
|---|---|
| R5 1 B — unbounded acceptance-time evaluation | fixed predicates and constraints are evaluated within the maximal evaluation, under its bounds, and stored as `fixed_json` (R-BTN-175) |
| R5 2 absent `ontology` field | absent means none; a merge error posts `ontology: {error}` (R-BTN-174; S-BTN-155) |
| R5 3, 4, 5 dead holdings and `credential:` needs | any declared capability is an admissible `ref`; the CLI stops declaring a reported-dead holding for its session; needs are never `credential:` (R-BTN-126, R-BTN-177) |
| R5 6 one end re-evaluating many sets | bounded by the runner's grants and the per-evaluation bound, in the end's transaction (R-BTN-174) |
| R5 7, R6 1 B, R6 2 stale sets; the freshness bound; the alarm's real bound | evaluation in the write's transaction and at the reader's read after a program change; an alarm cycle defined as back-to-back turns, with fleet views recounted when it ends (R-BTN-174; S-BTN-146) |
| R5 8 resource blocks per leg | moot for choices: advice ranks alternatives and the leg falls through; a runner's own `runner`-scope instance always steers its advice (R-BTN-176, R-BTN-177) |
| R5 9, 10, 11 the window, removed courses, merge errors | a revert discards the waiting unit, which is stored with its course files; removal belongs to the unit; a merge error refuses the unit, not the sync (R-BTN-174) |
| R5 12, R6 11 write amplification; `ontology_proofs` | proofs computed on read and memoised; only changed `runner_derived` rows, counted against R-BTN-149 (R-BTN-174) |
| R5 13 latency budgets | the load test runs evaluations at the bounds (R-BTN-175, G-BTN-77) |
| R5 14, R6 14 `gatesFor`, not `isEligible` | named; the grant is checked against H, never D(H) (R-BTN-174) |
| R5 15, R6 10 refused heartbeats | §11.1's refusal of an ungranted capability deleted; G-BTN-5 narrowed |
| R5 16 S-BTN-143 | the declarer leaves too |
| R5 17, R6 3 choice-time rules | the choice stratum defined; none of it depends on `holds` or `derived` (R-BTN-176) |
| R5 18 bookkeeping | non-live runners are evaluated at their next heartbeat; rows go 30 days after last live, or with the grant (R-BTN-174) |
| R6 4 uncapped `choices` | at most 8 per leg, one evaluation per advance (R-BTN-177) |
| R6 5 refinement in core | the CLI checks; core stores the chain (R-BTN-176) |
| R6 6 `derived` in course files | moved to `ontology.json` (owner); condition 4 checks every course declaring the type (R-BTN-174, R-BTN-175) |
| R6 7 the fleet view's `ETag` | a `runner_derived` change bumps `fleet_version` (R-BTN-99) |
| R6 8 a dead choice holding ends the claim | advice carries `ranked`; the leg falls through (R-BTN-177) |
| R6 9 `BATON_ROUTE` | created empty per leg, one entry per choice, ≤ 4 KB, never fails an end (R-BTN-177) |
| R5 19–25, R6 12–17 nits | R-BTN-120's prose; S-BTN-146's test seam through the test bindings; the same-digest sentence replaced by unit equality; `exclude_when` filters advice; untyped positions and reflexive "depends on"; S-BTN-147, S-BTN-148 and S-BTN-153 set-ups; a route against `null` advice stored; `choice_last` not written on a refused advance; rule 4 at an advance is intended, as for a lost declaration |

*(2026-10-22, round 7 — Fable 5.1 again, over §5.9, §6.10 and §6.11 after the rewrite. It
confirmed the formal core with clingo and checked several round 5–6 dispositions in the text:
1 blocking, 13 should-fix, 2 simplify, 8 nits. The owner accepted the four recommendations
(route choices belong to the home's course entries; "route choice" renames the advice concept;
both simplifications), and the rewrite resolved every finding as below:)*

| Finding | Status |
|---|---|
| 1 B — a sourced course's home cannot add `choices`; a standard course listing them is refused without an ontology | route choices live in the home's course entry (`route_choices`), never a course file or a source's `entry.json`; standard courses list none (R-BTN-177, R-BTN-134; S-BTN-155) |
| 2 `human-operator` in G-BTN-57, S-BTN-32 and the vendored `ROLES` | G-BTN-57 and S-BTN-32 amended; the vendored `ROLES` entry is a docs-first change named in B-104 |
| 3 seats released at a fence-pending reap | held until `fence-cleared` or the fence deadline (R-BTN-178; G-BTN-162) |
| 4 a claim's own seats counted | seats held by claims other than this one (R-BTN-178) |
| 5 one `bills` for every `prefer` candidate | `prefer: [{ticket_id, leg?, bills?}]` (R-BTN-100, R-BTN-178) |
| 6 `service` bills dropped | bills are any usable instance (R-BTN-100) |
| 7 `host` missing from R-BTN-76 | added to usable instances and to who reports (R-BTN-76) |
| 8 claim-time seats; rule 11 missing from §6.6; no `why` | a claim's seats are for the leg it is for, until its first advance; rule 11 in the claim and advance re-runs and pipeline step 4; `busy` in R-BTN-120's table |
| 9 no channel for a dead holding | a `BATON_ROUTE` entry's `dead` (R-BTN-177) |
| 10 what a runner bills | specified in R-BTN-178 |
| 11 a crossed evaluation retried at every read | stored empty and `limited` under its input digest (R-BTN-174) |
| 12 a grant change evaluating many runners | sets are current by input digest; a grant change evaluates nothing itself, and reads and the alarm cycle catch up (R-BTN-174; S-BTN-146) |
| 13 G-BTN-5 against derivation past the grant | narrowed to holdings (G-BTN-5) |
| 14 "choice" names two things | renamed "route choice" (`route_choices`, `route_last`); vocabulary amended (R-BTN-177) |
| 15 Simplify — condition 4's `values` check | dropped; a non-matching atom is inert (R-BTN-175) |
| 16 Simplify — the 5-minute window | dropped with `pending_json`; a unit is judged at each post (R-BTN-174) |
| 17–24 nits | grant changes covered by the input digest; the constant alphabet already had `_` (no change); alarm instants added, `capacity` in `POST /v1/admin/instances`, the `{error}` form in §4.4, capacity changes never take back a seat; the holder named only where the asker is granted, `host` instances in the instance view; `seat` off R-BTN-50's banned list; cloud runners use `runner` scope; R-BTN-69's choices check gone with the field, and holds-dependent predicates outside the gate stratum refused; `missing` split from `ungranted` |

*(2026-10-22, round 8 — Fable 5.1, after round 7's rewrite. It confirmed the formal core and the
hysteresis rules with clingo and found round 7's dispositions in the text: 1 blocking, 7
should-fix, 1 simplify, 7 nits, none a design question. Resolved:)*

| Finding | Resolution |
|---|---|
| 1 B — route choices' `needs` were checked against course files that standard courses lack | needs are shape-checked only; the unit no longer reads course files beyond legs' existence (R-BTN-174, R-BTN-177; S-BTN-155) |
| 2 the rename reached two choice-station references | restored in R-BTN-120 and R-BTN-12 |
| 3 "route" named the owner's re-route and the leg's report | the report is `taken` (`BATON_TAKEN`, `taken_json`, `taken-invalid`) |
| 4 "entry kept at its previous version" | only the `route_choices` field keeps its previous value (R-BTN-174) |
| 5 the `gatesFor` claim | stated as B-104's amendment, `isEligible` docs-first (R-BTN-174) |
| 6 a `dead` holding stale at the advance reporting it | removed in that advance's or end's transaction (R-BTN-177; S-BTN-153) |
| 7 seat statements | G-BTN-162 bounds admission; a silent reap releases at the reap, a fence-pending one after the fence (R-BTN-178) |
| 8 one read evaluating many repositories | no write evaluates; a claim, advance or why-not evaluates its one repository, a recommendation at most two, leaving out legs of repositories not yet current (R-BTN-174) |
| 9 Simplify — the input digest over all of H | over H restricted to the program's constants (R-BTN-174) |
| 10–16 nits | `route_choices_json`; `meters` placement; the instance view and §11.4's runners view; an empty `demote_when` refused, a leg absent from the course refused, needs outside the constant syntax refused; R-BTN-75 recounts derived rows when sets become current; the `derived` list never names `credential`, `runner` or `human-operator`; capacity-less resources billed for ranking |

The owner accepted round 8's verdict without a further review (2026-10-22); B-104 and B-105 returned to `available`.

*(2026-10-28 — §12.8 at `f378ec3` (with the security model and B-122–B-140) was reviewed
adversarially by a fresh agent: the shape right, the headline ("one compromised runner cannot land
a change alone") not yet delivered; 17 new findings (N1–N16 and N8a), 3 critical; of the 21 findings of the
security model's own review (2026-10-27), 3 closed, 17 partly closed, 1 open. Resolved in the
rewrite around attestations and trusted runners:)*

| Finding | Resolution | The next review's verdict |
|---|---|---|
| N1 a reviewer pushes to the branch and approves its own commit; "every key that wrote that head" is not computable | `std:wrote@1`: Baton attests each head a writing leg reports; a merged head and every commit since the merge base must be one; independence is computed over that chain, from a review claim that started at the head (R-BTN-181, R-BTN-183) | partly |
| N2 required checks are attacker-controlled | commit statuses never read; checks only as `std:checks@1` from the trusted executor running protected course data, or check runs from a workflow file on protected main with main's blob; checks named as no security gate (R-BTN-183) | partly |
| N3 merge-runner-landed code runs with main-only secrets; baton's `src/` unprotected | every path a deploying or releasing workflow executes is protected; for `baton` that is the whole repository, so every merge there needs a human (R-BTN-184, R-BTN-180) | partly |
| N4 the floor misses executed and authority paths; `tickets/**` is not every home's | the floor is computed per repository: `imports`, the ticket source's items path and the goal path, `.github/actions/**` and workflow-local `uses`, a per-harness list (`.mcp.json`, opencode), CODEOWNERS, authority paths (R-BTN-184) | partly |
| N5 renames, symlinks, gitlinks, case; source pins at any ancestor | `diff-tree --no-renames` from main's tip to the merge result plus `merge-base --all`; modes 120000 and 160000 and `.gitmodules` refused; `p` and `p/`, case-folded, NFC; pins at first-parent or release-tag commits only (R-BTN-183, R-BTN-134) | resolved |
| N6 `legs/merge.run.mjs` runs repository code with the credential | may only add refusals, in a child without credential, network, clock or environment; the CLI's rules apply after (R-BTN-182) | partly |
| N7 the merge credential's power, placement and per-forge identity | stated as human-level for what it may do; never on the owner's machine under `protected`; GitHub bypass only a dedicated App without Administration, never Actions, a role, a team or Dependabot; GitLab Free by deploy key; plain git needs pusher identity and no file access (R-BTN-182, R-BTN-180) | partly |
| N8 the human gate: dashboard cookie, self-registered keys, the browser, protected settings | WebAuthn per act on the dashboard; a `human_only` key registered only by an existing one, bootstrapped out of band, hardware-attested where possible; no agent tool on the human's browser or desktop; every protected setting and the message of the day are human gates; the owner's agent is a principal; trusted runners pin `human_only` keys themselves (R-BTN-185, R-BTN-182) | partly |
| N8a own-progress exception: unapproved instructions, link definitions, the heading, the mirror | appended entries are one plain-text line each, no link, definition, heading, HTML, MDX, fence or backtick; the last `## Status` line, LF, outside fences, present at the base; none takes no progress; bytes at the end, no renames, exact path; the archive move by the merge runner; the mirror writes nothing to main under `protected` (R-BTN-184, R-BTN-180) | partly |
| N9 environment reviewers gate every run | reviewers only on deploy and release environments; trusted runners' and the sync's environments limited to the default branch, unattended (R-BTN-180) | resolved in the spec |
| N10 tags and other refs | runners create and update only `branch_pattern` refs; rulesets on tags too; `repo protect` prints both (R-BTN-180) | resolved |
| N11 R-BTN-184's protected list a subset of R-BTN-66's | R-BTN-186 lists every R-BTN-66 setting, the grant `sync` flag and `untrusted` mark, `landing`, `protected_paths` and writer policies | partly |
| N12 git-sourced verdicts and trailers still move tickets; squash forges trailers | under `protected`, stations a trusted leg acts on come from attestations; the merge runner writes its own commit message; a human's merge is a `sender.id` that is not a trusted runner's (R-BTN-187, R-BTN-183, R-BTN-184) | partly |
| N13 `cooperative` default; `landing` unchecked | `untrusted` grants are refused on `cooperative` repositories; the sync and trusted runners compare the forge's protection with `repo protect` every run and stop on a difference (`baton.unprotected`) (R-BTN-180) | partly |
| N14 inconsistencies | R-BTN-46, R-BTN-66 and R-BTN-116 amended; §14 route added; §12.1 rows corrected (no runner secret as a boundary); rule `trusted` keeps ordinary runners off trusted legs. Fieldhouse's Axiom 4 and R-FH-11 remain the owner's to amend in Fieldhouse | partly |
| N15 push deliveries capped or missing | compared with the forge's compare range; truncated or missing deliveries, and more than three tags at once, fail closed (R-BTN-187) | resolved |
| N16 the signature over itself; unsigned review approvals; imports | signed over every other field; review attestations are `baton`-written and never a human gate; an import drops every attestation; the R-BTN-33 exception named (R-BTN-181) | partly |

*(2026-10-28 — §12.8 at `2e3bfa7` was reviewed adversarially by a third fresh agent: the headline
did not yet hold, one compromised runner could still land a change alone; N1–N16: 4 resolved, 12
partly, 1 not (Fieldhouse's Axiom 4, since amended in fieldhouse#7); 20 new findings. Addressed in
the revision that follows, with the owner's four decisions. The fourth review judged these
resolutions 1 resolved (R15), 7 mostly and 12 partly; the table below says what was done, and the
fourth round's table what remained:)*

| Finding | Resolution | The next review's verdict |
|---|---|---|
| R1 the `std:wrote@1` chain has no continuity: a planted commit is laundered through an honest fixer | runners sign every commit with their Baton key; a writing claim reports its start head, which must be the last attested head, and the CLI refuses any other tip (`baton.foreign-commit`); the merge needs an unbroken chain of attested ranges, each commit signed by its leg's key (R-BTN-183; the owner's decision) | partly |
| R2 independence by key, several keys per host | trust domains: one grant per domain per repository, set by a human gate; independence over domains (R-BTN-180, R-BTN-183; the owner's decision) | partly |
| R3 the everyday account keeps admin rights; the check cannot see bypass actors | two forge identities, the everyday one with no administrative role; GitHub needs an organisation and a human-only team; the check uses a read-only App with Administration read; changes between runs fail closed; a human's merge is the human-only identity's sender only (R-BTN-180, R-BTN-184, R-BTN-185; the owner's decision) | partly |
| R4 bootstrap, credential management and writer policies rooted in agent credentials | administrators are `human_only`; credential management, trust domains, the `trusted` mark, owner-key removal and writer policies are human gates; trusted runners pin writer classes and `service` keys (R-BTN-182, R-BTN-185) | mostly |
| R5 a touch or a WebAuthn assertion on a machine agents drive | PIN and touch, FIDO attestation against an allowlist; the CLI shows the fields and requires a derived code typed on an undriven terminal; the dashboard only prepares approvals unless its authenticator is attested and pinned (R-BTN-185) | partly |
| R6 the headline overclaims | the guarantee and what it does not cover are stated; two reviewers of different model families; `protected_paths: ["**"]` for deployed main (§12.8 preamble, R-BTN-183; the owner's decision) | partly |
| R7 the override exfiltrates through `reasons`; isolation unspecified | Linux namespace without network or credential, the diff as only input, a fixed time; `reasons` from a closed list (R-BTN-182) | mostly |
| R8 `.npmrc` and the Actions cache | trusted runners install by tarball integrity outside any checkout without package configuration; privileged jobs restore no cache and run with a read-only `GITHUB_TOKEN`; `.npmrc`, `.yarnrc*`, `.envrc` protected (R-BTN-180, R-BTN-182, R-BTN-184) | partly |
| R9 the outbox and call legs still write main | under `protected` only a trusted runner drains the outbox, from templates; call-leg children and promoted questions are held in Baton until approved (R-BTN-180; notes on R-BTN-165, R-BTN-171, R-BTN-173) | partly |
| R10 no revocation; uniqueness blocks re-attestation; signature over mutable fields | `DELETE` revokes (a human gate for `human` types); a new attestation supersedes; the signature covers canonical JSON of fixed fields with a nonce, namespace `baton-attestation@1`; consumption by compare-and-swap, restored only on a provable forge refusal (R-BTN-181, R-BTN-182) | partly |
| R11 own-progress entries forgeable and injectable | leg and nonce must equal the claim's, time within its span; a character whitelist without URLs, 300 bytes, 20 entries; the base ends in LF; readers show entries as the leg's data (R-BTN-184) | mostly |
| R12 `untrusted` optional; R-BTN-187 contradicts R-BTN-180 | every grant is untrusted unless marked `trusted`; one sync rule, in R-BTN-180 (R-BTN-180, R-BTN-187) | partly |
| R13 any runner can force-push any ticket's branch | foreign pushes raise `baton.foreign-push` and hold the ticket rather than re-running legs; per-claim forge credentials remain B-131 (R-BTN-183) | partly; worse in cost |
| R14 the floor partly not computable | what Baton can compute is listed; the rest is declared by the owner; a repository with any workflow using an environment or secret is `**` until narrowed; ticket sources declare their globs (R-BTN-184) | mostly |
| R15 holds and bars human-gated and taken from MCP | only loosening is gated; any owner credential, MCP included, may add holds and bars (R-BTN-186) | resolved |
| R16 `owner`-class attestations and runner-supplied subjects | the validator refuses a trusted leg on an `owner`-only type; trusted legs' subjects come from Baton-held values and always include the ticket (R-BTN-181) | partly |
| R17 the checks executor runs PR code beside its key | the executor's sandbox holds no credential; the key signs outside from the exit status; one `service` key per type (R-BTN-181) | mostly |
| R18 Baton-written facts trusted wholesale; imports strand work | `baton` attestations are signed with Baton's attestation key, which trusted runners pin; after an import, work re-attests by re-running its writing and review legs (R-BTN-181, R-BTN-182) | partly |
| R19 per-forge feasibility | the check and the human-merge signal are specified for GitHub, GitLab, Gitea and plain git (the pusher log) (R-BTN-180, R-BTN-184) | partly |
| R20 stale references | the history's references corrected; `where` defined; §13 tables and columns, §14's revoke route and §15's scenarios S-BTN-180–187 added. B-128, B-140 and the security model are updated in baton#133, the spec in baton#134 | partly |

*(2026-10-29 — §12.8 at `cda30b2` was reviewed adversarially by a fourth fresh agent: the guarantee
did not hold, not ready to merge as a proposal, but close; of R1–R20, 1 resolved, 7 mostly, 12
partly (among them R3, whose read of GitHub's bypass actors needs write access to the ruleset, and
whose audit log exists only on Enterprise Cloud); 17 new findings. Addressed in the revision that
follows, with the owner's decisions on F1 and on signed authorship:)*

| Finding | Resolution | The next review's verdict |
|---|---|---|
| F1 a writer's code runs in its reviewers' and fixers' domains, ending their legs or reading their keys | a domain that runs a branch's code is one of its writers (`std:ran@1`); reviews are `reads_only` legs that load agent configuration from the default branch and run nothing; tests run only in the trusted executor; Baton keys sit outside domains that run branch code, behind a host-side signer in Fieldhouse's profile (R-BTN-181, R-BTN-183; the owner's decision) | not resolved |
| F2 the exclusion understates the risk | stated exactly: a compromised runner that is one reviewer needs to persuade the other (§12.8) | partly |
| F3 the `trusted` mark makes `cooperative` unusable | the trust level (`trusted`, `untrusted`) is separate from the trusted-runner role; under `cooperative` grants are `trusted` by default (R-BTN-180) | mostly |
| F4 the outbox and handler tickets still write ticket files to main | the outbox never writes a ticket file under `protected`; handler tickets, call children, promoted questions and supersession replacements are held in Baton until approved, in batches (R-BTN-180; notes on R-BTN-161, -165, -171, -173) | partly |
| F5 signed commits do not fit API keys, session isolation, WIP pushes, merges from main, rebases, B-101 | signing is the opt-in `authorship: signed`; under it, SSH keys only and session legs sign through their runner; a leg's own intermediate pushes are its range; commits reachable from main are outside every range; a rebase replaces the range; B-101's review files are written by the trusted runner (R-BTN-183) | partly |
| F6 the human-merge path is not gated | `human-merge` shows the computed view of the head (chain, reviews, checks, diff); a merge of anything but the presented head is a discrepancy; `**` applies only where a workflow uses a deploy or release secret (R-BTN-184) | partly |
| F7 a tree binding voids approvals whenever main moves | approvals bind paths and blobs, checked against the merge result's blobs; main moving voids one only if it changes an approved path (R-BTN-181, R-BTN-183) | mostly |
| F8 supersession forbids two reviews; revoked keys keep counting | supersession is per writer; an attestation counts only while its writer's key is unrevoked (R-BTN-181) | not resolved |
| F9 approval queues bypassed in practice | batch approval for held tickets; the queue stays the cost the owner accepted under Fieldhouse Axiom 4 | partly / not |
| F10 contradictions with values 6 and 12, the architecture page, R-BTN-35, Fieldhouse Axiom 6 | protections read from git and the forge, never deliveries (values 6); values 12 and the architecture page state the opt-in exception and one grant per sandbox; R-BTN-35's note; Fieldhouse's profile rule (fieldhouse) carries the host-side signer under Axiom 6 | partly |
| F11 runners can edit GitHub releases | a release is the signed tag and the package's provenance, never the forge's release object (R-BTN-180) | partly |
| F12 the CLI's dependencies come from the registry | the release ships `npm-shrinkwrap.json`, so every dependency is pinned (R-BTN-182) | mostly |
| F13 foreign-push detection cannot see signatures; clearing costs a ceremony | the trusted runner finds foreign commits from git, resets the branch, and raises `baton.foreign-commit`, an `owner` resolution (R-BTN-183) | partly |
| F14 the model family is self-declared | set on the grant with its trust level, a human gate; a review leg runs only that family (R-BTN-183) | partly |
| F15–F17 the validator's "alone"; `refs/baton/*`; `baton request`; the unpinned base; the key's machine; instance-wide administrators; the sandbox's needs | the validator refuses any `owner`-writable type on a trusted leg; `refs/baton/*` only for trusted runners and humans; `baton request` opens a PR under an untrusted credential; the base pinned by compare-and-swap; the human-only key only on a machine no agent drives; `human_only` administrators only on instances with a `protected` repository; `bubblewrap` with PID namespace and `/proc`, refused where unavailable (R-BTN-180–R-BTN-185) | mostly / mostly under `hardware`, not under `any` / mostly |

*(2026-10-29 — the fifth adversarial review, of §12.8 at `da402e7` with fieldhouse `4ba731a`, found
the strongest guarantee still failed and the amendment not ready, but narrower: F1 and F8 not
resolved, 9 partly, 6 mostly (the column above), and new findings N1–N11 of its own. With the
owner's agreement the amendment was finished as a proposal, not reviewed a sixth time in full:
supersession keyed by the attested key (F8, N4); proposed tickets on branches, unclaimable and
unread until approved, holding only filter fields (N3); the `protected` row split into what the
forge enforces against any runner and what holds against mistakes only; the `human_key` qualifier
and exclusion (N6); mode switches resetting ungated settings (N5); `std:wrote@1` no longer
asserting signatures Baton cannot see (N10); F1 and N1 stated as the deployment's to enforce, which
Fieldhouse does (R-FH-3; review legs without command execution, VM resets); the host repository
writable by the human-only identity only (N2, fieldhouse#7); the rest recorded under Open
questions.)*

