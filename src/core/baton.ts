// baton.ts — Baton's core (BATON_SPEC §3, §3a R-BTN-55): every table, every write, the routing
// of the API behind the front (front.ts), and the alarm. It names no platform: a host hands it
// the ports (ports.ts) — the Durable Object on Cloudflare (src/cloudflare/), a Node process
// locally (src/local/) — and runs one request at a time between awaits, as §3 requires. Each
// request's writes are one transaction, so the compare-and-set below needs no lock. Requests
// reach it only through the front, which has verified the principal — all but a signed
// request's key, signature, clock and nonce, which only the core can check (verifySigned).
import { MIGRATIONS } from '../migrations';
import { versionedStore, clockBucket, ifNoneMatch, nonScheduling, schedulingVersion, type VersionedStore } from './stateVersion';
import { runnerViewResponse, requireFleetScope } from './runnerViews';
import { BatonError, CLIENT_HEADER, errorResponse, json, servedClientVersions, withClientVersions } from './http';
import { checkPayload, DEFAULT_COURSE, resolveParents, retiredBoardFields, rowFor, rowForTicket, rowHash, stationOf, type BoardPayload, type PostedStation, type TicketRow } from './board';
import { Stations, type Seen } from './stations';
import { Questions } from './questions';
import { Conditions } from './conditions';
import { Admin, SESSION_COOKIE, SESSION_MS } from './admin';
import { familyOf } from '../shared/baton.mjs';
import { fitsTier, TIERS } from '../shared/vocabulary.mjs';
import { clientVersionOf } from '../shared/versions.mjs';
import { RunnerApi } from './runnerApi';
import { parseAdminKeys, parseSshKey, verifyApiKey, verifyRequest, withBody, type SyncCredential } from './auth';
import { Claims } from './claims';
import { Cutover } from './cutover';
import { Mirror } from './mirror';
import { CAPABILITY_NAME, checkAttestation, checkConfirmations, checkDependenciesRead, checkRepositoryId, checkSequenceTake, COURSE_ID, GIT_BRANCH, GIT_REPO, SEQUENCE_KIND } from './validate';
import { Courses } from './courses';
import { Observations } from './observations';
import { Sequences } from './sequences';
import { Webhooks, type Delivery } from './webhook';
import { checkCrossBoardCycle, checkCrossRepository, consentRoute, resolveDependencies } from './dependencies';
import { fileUrl } from './links';
import { Stats } from './stats';
import { Blocks } from './blocks';
import { Resources } from './resources';
import { Notices, type Courier } from './notices';
import { Queues } from './queues';
import { History, HISTORY_PAGE_MAX } from './history';
import { InstanceSettings } from './instanceSettings';
import { Provenance, briefMark, writtenBy } from './provenance';
import { Capacity, RequestRing, adjustCounts } from './capacity';
import { OwnerState } from './ownerState';
import { checkBlockedOn, checkNoticeClaim } from './validate';
import { checkResync } from './validate';
import { Registry, TICKET_ID, qualify, repositoryOf, tierPosition, type Repository, type SyncClaims } from './registry';
import { codeReposOf, pushersOf } from './codeRepos';
import { Policies, sha256HexSync } from './policy';
import { Scope } from './scope';
import { logEvent, systemRandom } from './db';
import { Deprecated } from './deprecated';
import { Retention } from './retention';
import type { DispatchTarget, Ports, Row, SqlValue, Store, Workflow } from './ports';
import { dispatchRead } from './reads';
import type { ReadPrincipal } from './reads/kit';

const HELD_AUTO_ACCEPT_MS = 24 * 3_600_000; // R-BTN-11: measured from the first post of the held history.
const RESYNC_WINDOW_MS = 30_000; // B-201: a session's resync, once per repository per R-BTN-73's dispatch window
const ALARM_EVERY_MS = 60_000; // §3: one alarm, every 60 seconds
/** One path segment, decoded: a malformed escape is the caller's error, never a 500. */
function pathSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new BatonError('invalid-params', 'a malformed path segment');
  }
}

export class BatonCore {
  /** The clock (R-BTN-32). Tests replace it; nothing else here reads the time. */
  now: () => number;
  /** The random source (B-185: a run id's random half). Tests replace it, as the clock. */
  random: (n: number) => Uint8Array;

  readonly runners: RunnerApi;
  readonly claims: Claims;
  readonly cutover: Cutover;
  readonly mirror: Mirror;
  readonly registry: Registry;
  readonly courses: Courses;
  readonly observations: Observations;
  /** §4.6 (B-176, R-BTN-199): the per-repository, per-kind sequences — every id written to git. */
  readonly sequences: Sequences;
  readonly webhooks: Webhooks;
  readonly stations: Stations;
  readonly admin: Admin;
  readonly stats: Stats;
  readonly blocks: Blocks;
  readonly resources: Resources;
  readonly notices: Notices;
  readonly queues: Queues;
  readonly history: History;
  /** R-BTN-149 (B-238): the alarm's prunes. */
  readonly retention: Retention;
  /** §13.1 (B-4, R-BTN-113): the administrators' instance settings — `link_hosts`,
   *  `session_hosts` and `check_app_id` — behind `PUT /v1/admin/settings`. */
  readonly instance: InstanceSettings;
  /** §4.4 (B-126, R-BTN-194): each ticket's provenance — who last pushed its body. */
  readonly provenance: Provenance;
  /** §6.4 (R-BTN-116): the person legs' questions, their answers and their expiry. */
  readonly questions: Questions;
  /** §7.1 (R-BTN-160, R-BTN-195; B-234): the raised conditions — the report route, the
   *  Needs-you list, and the run's end closing its open `interact`. */
  readonly conditions: Conditions;
  /** §12.8 (B-145): the repository policies, their floors, their guarantees. */
  readonly policies: Policies;
  /** §2.3 (R-BTN-87; R3-1258): the envelope's figures, its crossings and the day's usage
   *  (R-BTN-2) — the Capacity view and the alarm's `capacity` events read here. */
  readonly capacity: Capacity;
  /** §4.8 (R-BTN-88; R3-1258): owner state — freeze, seal, export and import, and the pending
   *  ticket-scoped rows an import waits on. */
  readonly ownerState: OwnerState;
  /** R-BTN-87: the object's own per-second request counts, the mean and burst the envelope
   *  judges — in memory, a live measurement that a restart resets. */
  private readonly requests = new RequestRing();
  /** B-134: the leg scope audit — the claim answer's scope, the findings both halves raise. */
  readonly scope: Scope;
  /** The retired-fields window (B-168, R-BTN-132): the day's logged fields, by field and actor —
   *  nothing else of it is held here (`deprecated.ts` writes the rows and the events). */
  readonly deprecated: Deprecated;
  /** The host's Store, counting writes into `state_version` (B-237, R-BTN-196). */
  readonly store: VersionedStore;
  /** §12: workflows to dispatch once the current request or alarm has committed, one per
   *  repository and kind. */
  private pendingDispatch = new Map<string, Workflow>();
  /** The dispatch call; tests replace it (as they replace `now`) to see what would be sent. */
  dispatcher: (workflow: Workflow) => Promise<unknown>;
  /** §3: a signature check (R3-1239) is awaited through this, so
   *  another request may run meanwhile on both hosts alike (R-BTN-55). */
  readonly outside: <T>(work: () => Promise<T>) => Promise<T>;

  constructor(private readonly ports: Ports) {
    this.now = ports.clock ?? (() => Date.now());
    this.random = ports.random ?? systemRandom;
    this.store = versionedStore(ports.store);
    this.dispatcher = (wf) => this.sendDispatch(wf);
    this.deprecated = new Deprecated(this.store);
    this.outside = ports.gate ? (work) => ports.gate!.outside(work) : (work) => work();
    const store = this.store;
    this.registry = new Registry({ store, now: () => this.now(), ensurePolicy: (repository, forge) => this.policies.ensure(repository, forge) });
    // §12.8 (B-145): the policy store, before everything that reads a knob — the claims' floor
    // rule, the heartbeat's reports and pins, the owner routes' approver checks.
    this.policies = new Policies({ store, now: () => this.now() });
    this.policies.releaseForFloor = (repository) => this.claims.releaseForFloor(repository);
    // R3-1258: the capacity envelope (R-BTN-87) and owner state (R-BTN-88).
    this.capacity = new Capacity({ store, now: () => this.now(), config: ports.config });
    this.ownerState = new OwnerState({ store, now: () => this.now(), origin: ports.config.BATON_ORIGIN,
      policies: this.policies, restoreNext: (...args) => this.stations.restoreNext(...args),
      dispatchMirror: (repository) => want({ repository, kind: 'mirror' }) });
    this.courses = new Courses({ store, requiredBars: (repo) => this.admin.requiredBars(repo), policies: this.policies });
    this.observations = new Observations({ store, now: () => this.now() });
    // B-176 (R-BTN-199): the identifier sequences, beside the observation counter they follow.
    this.sequences = new Sequences({ store, now: () => this.now() });
    // B-134: the scope audit, before the webhooks and the claims it serves — its hold callback
    // reaches the claims, built later, through the closure.
    this.scope = new Scope({ store, now: () => this.now(), hold: (ticket, claimId) => this.claims.holdForScope(ticket, claimId) });
    this.webhooks = new Webhooks({ store, now: () => this.now(), scope: this.scope });
    // R-BTN-47 (B-173): a want is recorded only for a live repository — the one predicate
    // (Registry.live) every rule that counts registered repositories reads.
    const want = (wf: Workflow) => {
      if (!this.registry.live(wf.repository)) return;
      this.pendingDispatch.set(`${wf.repository}:${wf.kind}`, wf);
    };
    // R-BTN-75: the blocks are written with their causes; `fits` is the claim gates' (R-BTN-77).
    // R-BTN-80, R-BTN-81: a decision's notices are queued and closed with it, and its history row written.
    this.notices = new Notices({ store, now: () => this.now() });
    this.history = new History({ store, now: () => this.now() });
    this.retention = new Retention({ store, now: () => this.now() });
    // B-4 (§13.1, R-BTN-113): the instance settings, before the runner calls and the claims that
    // read the session-host allowlist.
    this.instance = new InstanceSettings({ store, now: () => this.now(), config: ports.config });
    // B-126 (R-BTN-194): ticket provenance, read from the push deliveries the webhooks record.
    this.provenance = new Provenance({ store });
    const decisionRows = (ticket: string, ids: string[], kind: 'decision-opened' | 'decision-answered') => {
      for (const id of ids) this.history.record(ticket, { kind, detail: { decision: id } });
    };
    this.blocks = new Blocks({ store, now: () => this.now(), fits: (runner, ticket) => this.claims.fits(runner, ticket), history: this.history,
      decisions: {
        opened: (ticket, ids) => { this.notices.opened(ticket, ids); decisionRows(ticket, ids, 'decision-opened'); },
        closed: (ticket, ids) => { this.notices.closed(ticket, ids); decisionRows(ticket, ids, 'decision-answered'); },
      },
      queued: (ticket) => this.queues.touch(ticket) });
    // R-BTN-79: each leg's queue, counted where membership changes; a leg over its bound warns.
    this.queues = new Queues({ store, now: () => this.now(), held: (ticket) => this.blocks.isHeld(ticket),
      graph: (repo, course) => this.stations.graph(repo, course), notices: this.notices });
    this.resources = new Resources({ store, now: () => this.now(), blocks: this.blocks, deprecated: this.deprecated });
    this.admin = new Admin({ store, now: () => this.now(), registry: this.registry, adminKeys: () => ports.adminKeys.list(),
      accessIdentities: () => ports.accessIdentities?.read() ?? '', origin: ports.config.BATON_ORIGIN,
      dispatchSync: (repository) => want({ repository, kind: 'sync' }), fleetChanged: () => this.blocks.recount(), notices: this.notices,
      policies: this.policies, humanBreakGlass: () => this.humanBreakGlass(), reapForRetire: (repository, actor) => this.claims.retireReaps(repository, actor),
      conditionsForRetire: (repository) => this.conditions.retired(repository) });
    this.stations = new Stations({ store, now: () => this.now(), requiredBars: (repo) => this.admin.requiredBars(repo), history: this.history });
    // R-BTN-116: a person leg's question and answer. Its arrival moves the ticket as a claim's
    // does — the queues' membership follows (R-BTN-79), the blocks are re-evaluated (R-BTN-75),
    // a sync is asked (R-BTN-73) — and what it may not apply it records, never refusing (R-BTN-39).
    this.questions = new Questions({ store, now: () => this.now(), graph: (repo, course) => this.stations.graph(repo, course), history: this.history,
      queued: (ticket) => this.queues.touch(ticket), reevaluate: (ticket) => this.blocks.write([ticket]), isHeld: (ticket) => this.blocks.isHeld(ticket),
      linkBases: (ticket) => this.blocks.linkBases(ticket), answersFrom: (repo) => this.policies.current(repo)?.policy.inputs.answers ?? 'git',
      dispatch: (kind, ticketId) => want({ repository: repositoryOf(ticketId), kind }) });
    // B-234 (R-BTN-160, R-BTN-195): the raised conditions — a course's own vocabulary decides a
    // disposition (never the runner's word), a `suspend` url keeps only under R-BTN-92's link
    // bases (as a question's), and the Needs-you and list reads a delivery runner polls.
    this.conditions = new Conditions({ store, now: () => this.now(), graph: (repo, course) => this.stations.graph(repo, course), history: this.history,
      linkBases: (ticket) => this.blocks.linkBases(ticket) });
    this.claims = new Claims({ store, now: () => this.now(), random: (n) => this.random(n), stations: this.stations, admin: this.admin, blocks: this.blocks, history: this.history,
      schema: (repo, id) => this.courses.schema(repo, id), intake: (repo, course) => this.queues.intake(repo, course),
      dispatch: (kind, ticketId) => want({ repository: repositoryOf(ticketId), kind }) ,
      policies: this.policies, forgeOf: (repo) => this.registry.get(repo)?.forge ?? 'github', scope: this.scope, deprecated: this.deprecated,
      conditions: this.conditions, sessionHosts: () => this.instance.sessionHosts() });
    this.cutover = new Cutover({ store, now: () => this.now(), held: (ticket) => this.blocks.held(ticket, true) });
    this.stats = new Stats(store, this.queues);
    this.mirror = new Mirror({ store, now: () => this.now(), held: (ticket) => this.blocks.held(ticket, true) });
    this.runners = new RunnerApi({ store, config: ports.config, now: () => this.now(), fenced: (w, inc, id) => this.claims.fenced(w, inc, id),
      legFinished: (w, id, seq) => this.claims.legFinished(w, id, seq),
      deprecated: this.deprecated, fleetChanged: () => this.blocks.recount(),
      // B-4 (R-BTN-113): the session-host allowlist the heartbeat's link rule reads.
      sessionHosts: () => this.instance.sessionHosts(),
      // R-BTN-103: what it delivers as a runner courier.
      couriers: (w, granted, entries) => this.notices.declare(w, granted, entries),
      // R-BTN-75 as amended by R3-1254 (B-26): a shadow claim's start is silent, its end an event.
      held: (ticket, silent) => this.blocks.held(ticket, silent),
      claimView: (id) => this.claims.holderView(id),
      // §12.8 (R-BTN-180): the protection reports a heartbeat carries.
      policies: this.policies,
      // A granted key's repositories are its grants' (R-BTN-58); an ungranted one's, every one it may reach.
      bars: (now, cred) => this.admin.bars(this.runners.credential(cred).granted
        ? this.sql<{ repository_id: string }>('SELECT repository_id FROM runner_grants WHERE credential_id = ? AND revoked_at IS NULL', cred).map((r) => r.repository_id)
        : null, now).map(({ id: _id, release_holders: _r, ...b }) => ({ repository: b.repository_id, course: b.course, tag: b.tag, legs: b.legs, applies: b.applies, starts_at: b.starts_at, ends_at: b.ends_at, reason: b.reason })) });
  }

  /** Before the first request (§3): every migration applied — the core refuses to serve until
   *  they are — and the one alarm armed. The host runs this before it lets a request in. */
  async start(): Promise<void> {
    this.migrate();
    // B-91: the seed's owner keys (R-BTN-58) are parsed first — a malformed one stops the start
    // before any entry registers — and written after the registration and its sync keys, so a
    // rebuilt instance serves its owners without anyone re-adding them.
    const seedOwners = await this.admin.readSeedOwners(this.ports.config);
    this.store.transaction(() => this.registry.seed(this.ports.config));
    await this.registry.seedSyncKeys(this.ports.config, this.ports.adminKeys.list());
    await this.admin.seedOwners(seedOwners);
    await this.seedKeys();
    // §12.8 (B-145): every repository's version 1 — the cooperative preset on a forge,
    // plain-git where the forge is git — so every reader finds one.
    this.store.transaction(() => this.policies.seedAll());
    await this.keepAlarm();
    // A trailing webhook dispatch owed from before a restart keeps its time (round 1, 1-A-4);
    // so do a trailing unblocked dispatch and the next reading to lapse (R-BTN-76, R-BTN-77).
    await this.armBy(this.webhooks.nextTrailing());
    await this.armBy(this.webhooks.nextDue());
    await this.armBy(this.blocks.nextDue());
    await this.armBy(this.resources.nextLapse());
    // R-BTN-90 (B-234): a claim deadline armed before a restart still wakes the alarm.
    await this.armBy(this.claims.nextDeadline());
  }

  /** The runner keys from BATON_KEYS (R3-1239). A list that cannot be seeded changes nothing
   *  and stops nothing — the keys in force stay, and the sync, the dashboard and every other
   *  principal serve on — but goes to Needs you, as does a revoked key the list names again. */
  private async seedKeys(): Promise<void> {
    const before = this.keysNotice();
    // What the list in force last reported stands until another list seeds.
    let notice: { refused?: string; revoked_listed?: string[] } | null = before?.revoked_listed ? { revoked_listed: before.revoked_listed } : null;
    try {
      const r = await this.runners.seedKeys();
      if (r.unchanged) {
        // The list that last seeded is back (a refused one never seeds): its refusal is over.
        if (!before?.refused) return;
      } else notice = r.revoked.length ? { revoked_listed: r.revoked } : null;
    } catch (e) {
      notice = { ...notice, refused: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
    }
    this.store.exec(`INSERT INTO baton_settings (key, value) VALUES ('keys_notice', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify(notice));
  }

  /** Send the dispatches a committed transaction asked for — only for a repository after its
   *  cutover, when the mirror writes git; before it, claim.sh does. Never awaited by the
   *  caller's response. B-89: an `unblocked` trigger is its own automation whatever the mode;
   *  a sync's own asks (`own`) carry the same reason, and are sent the same way. */
  private flushDispatch() {
    // A repository's unblocked trigger is its own automation, not the mirror's: sent whatever its
    // mode. So is a sync Baton's own webhook path sends (B-89): a merge, and the alarm after one.
    const own = (wf: Workflow) => wf.kind === 'unblocked' || wf.own === true;
    const due = [...this.pendingDispatch.values()].filter((wf) => own(wf) || this.cutover.cutoverAt(wf.repository) != null);
    this.pendingDispatch.clear();
    if (!due.length) return;
    this.ports.dispatch.defer(Promise.all(due.map((wf) => this.dispatcher(wf).catch(() => false))));
  }

  /** §10.3: a repository's sync or mirror workflow, on its default branch. A repository with no
   *  mirror has nothing to dispatch for it; a retired one has nothing at all (R-BTN-47, B-173). A
   *  dispatch the forge refuses is logged with its reason (R-BTN-94): the want it answers stands
   *  until a post answers it, so a refusal costs latency, never correctness. */
  private async sendDispatch(wf: Workflow): Promise<unknown> {
    const repo = this.registry.live(wf.repository);
    if (!repo) return false;
    let target: DispatchTarget | null = null;
    if (wf.kind === 'unblocked') {
      // R-BTN-77: one input, `tickets`, JSON — every id and ref in it passed its rule (§10.4). Only
      // the GitHub App's dispatch is built here; GitLab's and Gitea's adapters are R3-1263's.
      const trigger = this.sql<{ t: string | null }>('SELECT unblocked_trigger AS t FROM repositories WHERE id = ?', wf.repository)[0]?.t;
      const t = trigger ? (JSON.parse(trigger) as { kind: string; workflow?: string }) : null;
      if (t?.kind !== 'github-app' || !t.workflow) return false;
      // R-BTN-94 (B-168): Baton reads no workflow file — one declaring no manual dispatch, or no
      // `tickets` input, is the forge's to refuse at dispatch, and the refusal is logged below.
      target = { github: repo.github, workflow: t.workflow.slice(t.workflow.lastIndexOf('/') + 1), ref: repo.default_branch, inputs: { tickets: JSON.stringify(wf.tickets ?? []) } };
    } else {
      const path = wf.kind === 'sync' ? repo.sync_workflow : repo.mirror_workflow;
      if (!path) return false;
      target = { github: repo.github, workflow: path.slice(path.lastIndexOf('/') + 1), ref: repo.default_branch };
    }
    try {
      return await this.ports.dispatch.send(target);
    } catch (e) {
      // R-BTN-94: the forge's refusal, with its reason — identifiers only, never a body (the
      // refusal's message is the forge's own words, capped like a notice's).
      this.store.transaction(() => logEvent(this.store, this.now(), 'discrepancy', 'baton',
        { kind: 'dispatch-refused', repository: wf.repository, workflow: wf.kind, reason: (e instanceof Error ? e.message : String(e)).slice(0, 500) },
        null, null, wf.repository));
      return false;
    }
  }

  /** R-BTN-93's one verifier: the repository a sync credential acts for in `role` — a sync key
   *  (signed; its signature, clock and nonce checked here, as every key's are), or a CI identity
   *  token the front verified (GitHub Actions OIDC, GitLab CI `id_tokens`). Anything else is
   *  refused. Returns the request with a signed body put back. */
  private async verifySync(req: Request, role: 'sync' | 'mirror'): Promise<{ repo: Repository; req: Request }> {
    if (req.headers.has('X-Baton-Signed')) {
      // Every key Baton knows verifies here, so a key in another role is told `forbidden`, not
      // `unauthenticated` — an administrator's included (round 1, 1-A-9).
      const admins = new Map<string, string>();
      for (const line of this.ports.adminKeys.list()) {
        try {
          admins.set((await parseSshKey(line)).fingerprint, line);
        } catch {
          // an unreadable line is no key
        }
      }
      const { req: signed, cred } = await this.verifySigned(req, (fp) => this.registry.syncKey(fp)?.public_key ?? this.runners.publicKey(fp) ?? admins.get(fp) ?? null);
      // An administrator key is never a sync's, even one added to BATON_ADMIN_KEYS after it was
      // registered as a sync key (round 3, 3-A-2).
      if (admins.has(cred)) throw new BatonError('forbidden', 'an administrator key holds no other role (R-BTN-57)');
      const key = this.registry.syncKey(cred);
      // A runner, probe, courier or administrator key is never a sync's (R-BTN-57, R-BTN-93).
      if (!key) throw new BatonError('forbidden', 'only a sync key may act as a sync');
      if (key.role !== role) throw new BatonError('forbidden', `this sync key serves its repository's ${key.role}, not its ${role}`);
      return { repo: this.registry.get(key.repository)!, req: signed };
    }
    const raw = req.headers.get('X-Baton-Sync');
    if (!raw) throw new BatonError('unauthenticated', 'no sync principal');
    const claims = JSON.parse(raw) as SyncCredential;
    const repo = claims.kind === 'gitlab' ? this.registry.forGitlab(claims, role) : this.registry.forSync(claims, role);
    return { repo, req };
  }

  /** R-BTN-73: a verified delivery's fields, from the front. Its syncs go after the response;
   *  a suppressed one waits for its window's trailing dispatch, which the alarm sends, armed
   *  early for it. */
  private async delivery(req: Request) {
    const raw = req.headers.get('X-Baton-Webhook');
    if (!raw) throw new BatonError('unauthenticated', 'no webhook principal');
    const out = this.store.transaction(() => this.webhooks.receive(JSON.parse(raw) as Delivery));
    if (out.outcome === 'dispatched') {
      // B-92's live run: the delivery's row is what proves it arrived, on either side of the
      // cutover. The dispatch itself goes to every repository the path named, whatever its mode
      // (§7.1 R-BTN-73: the sync posts the board snapshot before the cutover too, and a snapshot
      // under 15 minutes old is what cutover.ts needs when its day comes — the round-1 filter
      // held shadow repositories back while the alarm's own backstop sent them 30 seconds
      // later, so the code, the spec and the runbook disagreed until it went).
      this.syncNow(out.now);
      if (out.trailing.length) await this.armBy(this.webhooks.nextTrailing());
      // B-89: the stamp this delivery wrote arms the alarm for the backstop's instant.
      await this.armBy(this.webhooks.nextDue());
    }
    return out;
  }

  /** Dispatch these repositories' syncs after the response; a failure waits for the webhook
   *  path's own backstop or the schedule (R-BTN-73: never retried more than once). B-89: a
   *  dispatch from this path — a merge, the alarm after one, another repository's delivery — is
   *  sent whatever the repository's mode (`own`). A failure is not silently dropped: the stamp
   *  `receive`/`dueSync` wrote stands, and the alarm's `nextDue()` sends it again at
   *  `last_dispatch_at + SYNC_STALE_MS` (§7.1, round 4 finding 3). */
  private syncNow(repositories: string[]) {
    if (repositories.length) this.ports.dispatch.defer(Promise.all(repositories.map((repository) => this.dispatcher({ repository, kind: 'sync', own: true }).catch(() => false))));
  }

  /** B-229 (§2.1): the one alarm is kept by every request and every start, not only a start
   *  that finds none. An alarm that is missing, or overdue by more than two periods (a platform
   *  that gave up retrying a failing handler, or never fired it), is set again for the next
   *  period — found live: no tick ran for days while requests kept arriving, so nothing reaped.
   *  A request checks at most once a period (the read is the object's cached storage, but most
   *  requests need not make it at all); a start always checks. */
  private alarmCheckedAt = -Infinity;
  private async keepAlarm(fromRequest = false) {
    const now = this.now();
    if (fromRequest && now - this.alarmCheckedAt < ALARM_EVERY_MS) return;
    this.alarmCheckedAt = now;
    const at = await this.ports.scheduler.get();
    if (at == null || at < now - 2 * ALARM_EVERY_MS) await this.ports.scheduler.set(now + ALARM_EVERY_MS);
  }

  /** The alarm fires by `at` (§3: one alarm; set earlier, never later). */
  private async armBy(at: number | null) {
    if (at == null) return;
    const current = await this.ports.scheduler.get();
    if (current == null || at < current) await this.ports.scheduler.set(at);
  }

  /** §3: the one alarm, every 60 seconds — earlier when a webhook's trailing dispatch or the
   *  webhook path's own backstop is due. */
  // @model alarmLive sha256:6f9056ae3a4b
  async alarm(): Promise<void> {
    // R-BTN-88 (§4.8, R3-1258): a sealed Baton's alarm idles — it logs nothing and touches
    // nothing; the next period is kept armed (B-229), so the instance that imports this state
    // never inherits a dead clock.
    if (this.ownerState.sealedAt() != null) {
      await this.ports.scheduler.set(this.now() + ALARM_EVERY_MS);
      return;
    }
    // Re-armed first, so one failing tick never ends the cycle.
    await this.ports.scheduler.set(this.now() + ALARM_EVERY_MS);
    // B-89: the webhook path's own backstop, beside R-BTN-73's trailing dispatches — the App's
    // delivery reached Baton, and a merge's sync never went. Armed at the instant the earliest
    // stamp goes stale, so a tick that lands late does not make the send up to a minute later.
    const stale = this.store.transaction(() => this.webhooks.dueSync());
    this.syncNow(stale);
    this.syncNow(this.store.transaction(() => this.webhooks.dueTrailing()));
    await this.armBy(this.webhooks.nextTrailing());
    await this.armBy(this.webhooks.nextDue());
    let lapse: number | null = null;
    // B-229 (R-BTN-9): the reaper's share commits on its own, before the rest of the tick — a
    // later step that throws rolls back only itself, never the reaps (found live: twelve claims
    // held for days past their leases). A reap that could not be written is reported after
    // everything else has run, so the tick's own work is never lost to it.
    let unreaped: string[] = [];
    try {
      unreaped = this.store.transaction(() => this.claims.alarm());
    } catch (e) {
      this.pendingDispatch.clear();
      throw new Error(`the alarm's reaper failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    this.flushDispatch();
    let stage = 'runners';
    try {
      this.store.transaction(() => {
        this.runners.alarm();
        // R-BTN-76: readings lapse; R-BTN-75: liveness moves the counts; R-BTN-77: a pending
        // `unblocked` message dies with its runner's liveness, and a window's trailing dispatch goes.
        // Time moves liveness: recount when, and only when, the live set changed (R-BTN-75); a
        // lapsed reading's recount has already taken the live set, so a tick runs one recount.
        // R-BTN-78: a queued leg posted waiting for 72 hours is put to the owner. The recount's rows
        // and the stall's decision row are evaluated once, after both, before the dispatch reads
        // what unblocked (B-49).
        stage = 'resources and blocks';
        lapse = this.blocks.batch(() => {
          const next = this.resources.alarm();
          if (this.blocks.liveChanged()) this.blocks.recount();
          this.blocks.raiseStalled(this.now());
          return next;
        });
        stage = 'blocks.expireMessages';
        this.blocks.expireMessages();
        // R-BTN-39, R-BTN-116: answers that waited out a hold are applied first — before the
        // expiries, so a person's word wins over a clock that passed while the ticket was held
        // — then a person leg's expiry, due and still unanswered and unheld, arrives at its
        // `expires.reached`: Baton's own settlement, applied at the instant.
        stage = 'questions';
        this.questions.applyPending();
        this.questions.expireDue(this.now());
        stage = 'unblocked';
        this.takeUnblocked();
        // R-BTN-80: lapsed leases and due reminders queue again; old closed notices go.
        stage = 'notices';
        this.notices.alarm();
        // R-BTN-81: the history of tickets closed 90 days ago goes.
        stage = 'history.purge';
        this.history.purge();
        // R-BTN-149 (B-238): old events, snapshots and runner declarations, and the purged
        // tickets' claims — a batch a tick, each step through its index.
        stage = 'retention';
        this.retention.prune();
        // §12.8 (B-145, R-BTN-189): a protection report that lapsed past its 24 hours stops
        // feeding `no-runner-lands` — every repository with floors is re-judged, and a newly
        // broken one stops offering claims and releases its running ones.
        stage = 'policies.enforceFloors';
        this.policies.enforceFloors();
        // R-BTN-87 (R3-1258): the envelope's figures — a crossing of 80% logs `capacity` each
        // way, and `baton.capacity` stands under Needs you while one is over. Nothing is
        // refused; the counts are the store's, the rates the ring's.
        stage = 'capacity';
        this.capacity.alarm(this.capacityFigures());
      });
    } catch (e) {
      this.pendingDispatch.clear(); // rolled back: nothing to tell the mirror
      // B-229: the step is named, so a tick that keeps failing says where.
      throw new Error(`the alarm's tick failed at ${stage} (its reaps committed): ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    this.flushDispatch();
    await this.armBy(lapse);
    await this.armBy(this.blocks.nextDue());
    // R-BTN-116: the earliest person expiry still pending, so the alarm wakes at the instant.
    await this.armBy(this.questions.nextDue());
    // R-BTN-90 (B-234): the earliest armed claim deadline, so a run's clock wakes the alarm.
    await this.armBy(this.claims.nextDeadline());
    // B-229: a reap that could not be written fails the tick only now, after its work: the
    // failure reaches the host's log naming each claim, and the next tick tries it again.
    if (unreaped.length) throw new Error(`the alarm could not reap ${unreaped.length} claim(s): ${unreaped.join('; ')}`);
  }

  /** R-BTN-77: each repository's unblocked dispatch due now, queued to send after the commit. */
  private takeUnblocked() {
    for (const d of this.blocks.takeDue()) this.pendingDispatch.set(`${d.repository}:unblocked`, { repository: d.repository, kind: 'unblocked', tickets: d.tickets });
  }

  private sql<T = Row>(query: string, ...params: unknown[]): T[] {
    return this.store.exec<T>(query, ...params).toArray();
  }

  /** Apply the numbered migrations not yet applied, each in its own transaction. */
  migrate(): void {
    this.store.exec('CREATE TABLE IF NOT EXISTS _baton_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const done = new Set(this.sql<{ id: number }>('SELECT id FROM _baton_migrations').map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      this.store.transaction(() => {
        if (m.first) m.backfill?.(this.store, (n) => this.random(n), this.now);
        this.store.script(m.sql);
        if (!m.first) m.backfill?.(this.store, (n) => this.random(n), this.now);
        this.store.exec('INSERT INTO _baton_migrations (id, applied_at) VALUES (?, ?)', m.id, this.now());
      });
    }
    // B-237 (R-BTN-196): every write from here on moves the state version — its table exists now.
    this.store.track();
  }

  /** B-242's key (R-BTN-196): the state version — it moves with every write to Baton's state,
   *  liveness and nonces excepted, so a reader showing clock-dependent facts adds the clock. */
  stateVersion(): number {
    return this.store.version();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    this.pendingDispatch.clear();
    // R-BTN-87 (R3-1258): every request the object handles counts, for the envelope's rates and
    // the day's usage (R-BTN-2).
    this.requests.count(this.now());
    await this.keepAlarm(true);
    try {
      const res = await this.route(req, url);
      // An error answer means its transaction rolled back: nothing changed to mirror.
      if (res.ok) {
        // R-BTN-77: the unblocked dispatches this request made due, coalesced per window.
        this.store.transaction(() => this.takeUnblocked());
        this.flushDispatch();
        await this.armBy(this.blocks.nextDue());
        await this.armBy(this.resources.nextLapse());
      } else this.pendingDispatch.clear();
      // R-BTN-2 (R3-1258): the rows this request's transactions wrote, counted into the day's
      // usage — after the response is built, in a quiet write that never counts itself.
      this.recordUsage();
      // R-BTN-197 (B-254): the versions this instance serves, on every response under /v1 — the
      // code's `min` (never a setting's) and the recommended as this instance serves it, an
      // administrator's raise (instance_settings) included, clamped at or above `min`. The front
      // learns this value from these answers, for the responses it builds itself.
      return url.pathname.startsWith('/v1/')
        ? withClientVersions(res, servedClientVersions(this.ports.config, this.instance.recommendedClient()))
        : res;
    } catch (e) {
      this.pendingDispatch.clear(); // the transaction rolled back: nothing changed to mirror
      this.recordUsage();
      throw e;
    }
  }

  /** R-BTN-2 (R3-1258): one request handled and the rows it wrote, into the one `baton_settings`
   *  counter that resets at 00:00 UTC. Quiet, so the counter's own row is never usage. */
  private recordUsage(): void {
    const rows = this.store.takeWritten();
    this.store.liveness(() => {
      this.capacity.count(1, rows);
    });
  }

  /** R-BTN-87 (R3-1258): the figures the envelope judges — the store's counts beside the ring's
   *  rates. */
  capacityFigures() {
    return { ...this.capacity.counts(), ...this.requests.rates(this.now()) };
  }

  private async route(req: Request, url: URL): Promise<Response> {
    try {
      // R-BTN-88 (§4.8, R3-1258): a sealed Baton serves an administrator's reads alone — the
      // export among them — and refuses everything else `sealed` (503, retryable elsewhere).
      const sealedAt = this.ownerState.sealedAt();
      if (sealedAt != null && !(req.method === 'GET' && url.pathname.startsWith('/v1/admin/'))) {
        throw new BatonError('sealed', `this Baton was sealed at ${new Date(sealedAt).toISOString()} for its move; an administrator's reads alone are served (R-BTN-88)`);
      }
      // R-BTN-88: a frozen Baton refuses new claims (the claims' own gate) and owner writes —
      // lease upkeep, syncs and the administrator's own acts run on, so work drains and the
      // mirrors catch up before the seal. A person's attestation is an owner's write.
      if (this.ownerState.frozenAt() != null) {
        const ownerWrite = (req.method === 'POST' || req.method === 'PUT')
          && (url.pathname.startsWith('/v1/owner/') || /^\/v1\/repositories\/[^/]+\/attestations$/.test(url.pathname));
        if (ownerWrite) throw new BatonError('frozen', 'this Baton is frozen for a move: owner writes are refused until it is unfrozen or sealed (R-BTN-88)');
      }
      if (url.pathname.startsWith('/v1/sync/')) {
        // R-BTN-15: the board's routes take only the repository's sync workflow, the feed's only
        // its mirror workflow; each touches that repository alone.
        if (req.method === 'GET' && url.pathname === '/v1/sync/head') return json(this.head((await this.verifySync(req, 'sync')).repo.id));
        // R-BTN-62: the next number of the repository's counter, before the sync reads anything.
        if (req.method === 'POST' && url.pathname === '/v1/sync/observation') {
          const { repo: { id: repo }, req: signed } = await this.verifySync(req, 'sync');
          // R-BTN-62 (Release): a run that will not post gives its number back; only the
          // outstanding number is voided, so a stale release voids nothing.
          const release = ((await readJson(signed).catch(() => null)) as { release?: unknown } | null)?.release;
          if (release !== undefined) {
            if (!Number.isSafeInteger(release)) throw new BatonError('invalid-params', 'release must be the number this credential was handed (R-BTN-62)');
            this.observations.release(repo, release as number);
            return json({ released: release });
          }
          // R-BTN-67: with the owner bars in force or scheduled for the repository, each with its course.
          // B-110: and Baton's own record a station function judges git against — the owner's
          // answers to the sync's decisions, and the legs claims finished with an evidence
          // pointer (the claim's nonce beside it) — so a marker in git counts only as the
          // evidence Baton recorded, and an answer only as the owner gave it here.
          // B-127: the repository's owner signing keys — the public keys of its human-only
          // owners (B-136's register as far as it is built; an API key cannot sign) — beside
          // Baton's own record, so the sync that just took this number reads what counts from
          // Baton, never from the repository it is judging.
          // B-183 (§4.3): and each live ticket's last accepted `version`, handed back so the
          // source's own code — never Baton — judges whether its store read is older than what
          // the board holds, and refuses to post a ticket it judges behind (R-BTN-150).
          // B-182 (R-BTN-140): and the effective `code_repos`, each entry with its forge, host,
          // ids and web_base, and the owners' `pushers` host-qualified — what the fact adapter
          // reads each repository by, and whose words count there.
          return json({ ...this.observations.observe(repo), bars: this.admin.bars([repo], this.now(), true).map(({ repository_id: _r, ...b }) => b), code_repos: codeReposOf(this.store, repo), pushers: pushersOf(this.store, repo), ...this.claims.syncRecord(repo), versions: this.ticketVersions(repo), signing_keys: await this.admin.signingKeys(repo), require_signed_control: !!this.sql<{ flag: number }>('SELECT require_signed_control AS flag FROM repositories WHERE id = ?', repo)[0]?.flag });
        }
        if (req.method === 'POST' && url.pathname === '/v1/sync/board') {
          const { repo, req: signed } = await this.verifySync(req, 'sync');
          const body = await readJson(signed);
          // B-168: the part-4 retired fields the post carries, read before `checkPayload` drops
          // them from the body.
          const retired = retiredBoardFields(body);
          let p: BoardPayload;
          try {
            // The posting repository's id reads a self-qualified `depends_on` entry as the local
            // id alone in the one-board cycle graph (§3.1, B-113 round 1).
            p = checkPayload(body, repo.id);
          } catch (e) {
            // A refused post uses its number too (R-BTN-62), malformed or not, so the sync's
            // next run is not held off as busy for ten minutes.
            const n = (body as { observation?: unknown } | null)?.observation;
            if (Number.isSafeInteger(n)) this.observations.release(repo.id, n as number);
            throw e;
          }
          // …read as absent, and logged once per repository's sync credential, field and day
          // (the history's Migrations entry).
          if (retired.length) this.store.transaction(() => { for (const f of retired) this.deprecated.note(this.now(), `sync:${repo.id}`, f, 'board', repo.id); });
          return json(await this.board(repo, p));
        }
        // B-113 (§4.3): the sync's dependencies read — each qualified `depends_on` entry of
        // another repository the posting repository's tickets name, resolved against its
        // target's board (done, closed, its station, its link from the registration). The same
        // refusals the post would make come here first, so a sync that could not post fails
        // before it reads the forge; read after the number, as everything this run posts is.
        if (req.method === 'POST' && url.pathname === '/v1/sync/dependencies') {
          const { repo, req: signed } = await this.verifySync(req, 'sync');
          const ids = checkDependenciesRead(await readJson(signed));
          const sql = <T>(q: string, ...a: unknown[]): T[] => this.sql<T>(q, ...a);
          return json({ dependencies: resolveDependencies(sql, repo.id, ids) });
        }
        if (req.method === 'GET' && url.pathname === '/v1/sync/events') {
          const { repo } = await this.verifySync(req, 'mirror');
          const after = Number(url.searchParams.get('after') ?? 0);
          const limit = Number(url.searchParams.get('limit') ?? 200);
          if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit)) throw new BatonError('invalid-params', 'after and limit must be integers');
          // B-238: the read acknowledges the cursor it starts from (§12), for R-BTN-149's prune.
          this.store.transaction(() => this.mirror.acknowledge(repo.id, after));
          return json(this.mirror.events(repo.id, after, limit));
        }
        if (req.method === 'POST' && url.pathname === '/v1/sync/foreign-claim') {
          const { repo, req: signed } = await this.verifySync(req, 'mirror');
          const body = await readJson(signed);
          return json(this.store.transaction(() => this.mirror.foreignClaim(repo.id, body)));
        }
      }
      if (req.method === 'POST' && url.pathname === '/v1/github/webhook') {
        // §11: 204, and nothing of Baton's in the App's delivery log (round 1, 1-A-0).
        await this.delivery(req);
        return new Response(null, { status: 204 });
      }
      // R-BTN-185 (B-145): the human-only keys' own route, beside the administrator's and the
      // owner's.
      if (req.method === 'POST' && url.pathname === '/v1/human-keys') return await this.humanKeysRoute(req);
      // B-192, B-205: every read a session may call — the repository and owner reads it shares
      // with the keys among them — is one entry of src/core/actions.ts served through
      // src/core/reads/: one principal, one authorization, the one refusal, then the ETag.
      const read = await dispatchRead({ core: this, store: this.store, sql: (q, ...p) => this.sql(q, ...p), now: () => this.now(), config: this.ports.config }, req, url);
      if (read) return read;
      if (url.pathname.startsWith('/v1/admin/') || url.pathname.startsWith('/v1/owner/')) return await this.adminRoute(req, url);
      if (req.method === 'POST' && url.pathname === '/v1/login') {
        // R-BTN-155, R-BTN-16: exchange a link token or verified Access email for the session cookie — `__Host-`,
        // host-only, Secure, HttpOnly, SameSite=Strict, at most 12 hours.
        const value = await this.admin.login(await readJson(req), req.headers.get('X-Baton-Access-Email'));
        const res = json({ ok: true });
        res.headers.set('Set-Cookie', `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`);
        return res;
      }
      let owner: string | null = null;
      if (url.pathname.startsWith('/v1/ui/')) {
        // The dashboard's principal (R-BTN-57): a session minted from an administrator's key still
        // in BATON_ADMIN_KEYS. Access is hardening in front of it; on its own it serves only while
        // no administrator key is configured — the deployments that predate them (round 1, 1-A-6).
        owner = await this.admin.session(req.headers.get('X-Baton-Session'));
        if (!owner && !(await this.admin.adminFingerprints()).size) owner = req.headers.get('X-Baton-Owner');
        if (!owner) throw new BatonError('unauthenticated', 'the dashboard session ended or is unknown');
        if (req.method === 'GET' && url.pathname === '/v1/ui/session') return json({ ok: true });
        // B-206 (R-BTN-155, `ui.logout`): a session's own end — its row is revoked and the
        // cookie cleared, with the attributes it was set with (R-BTN-16). The caller is the
        // principal just resolved; nothing but its own session is named or ended.
        if (req.method === 'POST' && url.pathname === '/v1/ui/logout') {
          await readJson(req); // R-BTN-16's JSON body, read whole; it names nothing
          await this.admin.endSession(req.headers.get('X-Baton-Session'));
          const res = json({ ok: true });
          res.headers.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
          return res;
        }
      }
      // R-BTN-181's envelope (§14), B-7's slice: `POST /v1/repositories/{repository}/attestations`
      // with a `std:decision@1` — a person's answer to the ticket's queued person leg
      // (R-BTN-116), what `baton decision answer` writes (R-BTN-127). An owner key of the
      // repository or a human-only key (R-BTN-185) writes it; an administrator's key is never an
      // owner's (R-BTN-57) and writes nothing here.
      const attestation = /^\/v1\/repositories\/([^/]+)\/attestations$/.exec(url.pathname);
      if (req.method === 'POST' && attestation) {
        const repoId = pathSegment(attestation[1]);
        const repo = checkRepositoryId(repoId);
        // R-BTN-47 (B-173): a retired repository is `not-found`, as one never registered.
        if (!this.registry.live(repo)) throw new BatonError('not-found', `no repository ${repo}`);
        if (!req.headers.has('X-Baton-Signed') && !req.headers.has('X-Baton-Api-Key')) {
          throw new BatonError('unauthenticated', 'sign with an owner key of the repository or a human-only key, or send its API key');
        }
        const admins = await this.admin.adminFingerprints();
        // R-BTN-185: an owner key of the repository, or a human-only one — a registered human
        // key's own public line serves the signature lookup, not the host's break-glass lines
        // alone (a key registered through POST /v1/human-keys owns nothing, but answers).
        const signed = await this.authenticated(req, (fp) => admins.get(fp) ?? this.admin.ownerKey(fp) ?? this.admin.humanKeyLine(fp));
        const fp = signed.cred;
        const human = await this.admin.isHumanKey(fp);
        if (admins.has(fp)) throw new BatonError('forbidden', 'an administrator’s key is never an owner key (R-BTN-57); a person’s answer is an owner’s or a human-only key’s');
        if (!human && !this.admin.owns(fp, repo)) throw new BatonError('forbidden', `this key neither owns ${repo} nor is a human-only key (R-BTN-116, R-BTN-185)`);
        // §12.8, R-BTN-191: where the policy's `inputs.answers` is `attestation` (`protected`),
        // a person's answer counts from a human key alone — an owner key's does not.
        if (!human && (this.policies.current(repo)?.policy.inputs.answers ?? 'git') === 'attestation') {
          throw new BatonError('forbidden', `${repo}'s policy counts a person's answer from a human key alone (inputs.answers: attestation)`);
        }
        const b = checkAttestation(await readJson(signed.req), repo);
        return json(this.store.transaction(() => this.questions.answer(repo, b.ticket, b.value, human ? `human:${fp}` : `owner:${fp}`)));
      }
      // §4.6 (B-176, R-BTN-199): the sequence route — a write, so it has its own half beside
      // the blocks' reads, with the sync key admitted among its principals.
      const sequence = await this.sequenceRoute(req, url);
      if (sequence) return sequence;
      if (url.pathname.startsWith('/v1/courier/')) return await this.courierRoute(req, url);
      if (req.method === 'POST' && url.pathname === '/v1/probe/readings') {
        // R-BTN-53, R-BTN-101: a probe key's readings, on any registered instance.
        if (!req.headers.has('X-Baton-Signed')) throw new BatonError('unauthenticated', 'sign with a probe key');
        const signed = await this.verifySigned(req);
        const kind = this.sql<{ kind: string }>('SELECT kind FROM credentials WHERE id = ?', signed.cred)[0]?.kind;
        if (kind !== 'probe') throw new BatonError('forbidden', 'only a probe key posts here (R-BTN-57: one role per key)');
        const out = this.resources.post({ kind: 'probe', fingerprint: signed.cred }, await readJson(signed.req), null);
        return json(out);
      }
      const routed = await this.runnerRoute(req, url, owner);
      if (routed) return routed;
      throw new BatonError('not-found', `no route ${req.method} ${url.pathname}`);
    } catch (e) {
      // Drain an unread body so the forwarded stream completes before the response does.
      if (req.body && !req.bodyUsed) await req.arrayBuffer().catch(() => {});
      if (e instanceof BatonError) return errorResponse(e.code, e.message, e.extra);
      throw e;
    }
  }

  /** Needs you: a BATON_KEYS list that was refused, or that names a revoked key (R3-1239). */
  keysNotice(): { refused?: string; revoked_listed?: string[] } | null {
    const raw = this.sql<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'keys_notice'`)[0]?.value;
    return raw ? JSON.parse(raw) : null;
  }

  /** R-BTN-185 (B-145): the host's BATON_HUMAN_KEYS lines — the deployment's root of trust, read
   *  on every call like BATON_ADMIN_KEYS, with each key's stored line (type and base64 alone). */
  private humanKeyLines(): string[] {
    return this.ports.humanKeys ? this.ports.humanKeys.list() : parseAdminKeys(this.ports.config.BATON_HUMAN_KEYS ?? '');
  }

  private async humanBreakGlass(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const line of this.humanKeyLines()) {
      try {
        const k = await parseSshKey(line);
        out.set(k.fingerprint, `${k.type} ${line.trim().split(/\s+/)[1]}`);
      } catch {
        // a line that is no key admits nobody
      }
    }
    return out;
  }

  /** The versioned policy and its current guarantees (R-BTN-189). */
  private policyRead(repository: string): Response {
    const cur = this.policies.current(repository);
    if (!cur) throw new BatonError('not-found', `${repository} has no policy yet`);
    const at = this.now();
    return json({
      repository,
      version: cur.version,
      hash: cur.hash,
      policy: cur.policy,
      guarantees: this.policies.guaranteesFor(repository),
      floors: this.policies.floors(repository),
      check_app_id: this.instance.checkAppId(),
      at,
      // CLI 0.1.3 and 0.1.4 format this unconditionally in `owner policy show`.
      // Use the read time, not a future expiry: this response is unsigned.
      valid_until: at,
    });
  }

  /** `POST /v1/human-keys` (R-BTN-185, B-145): a `human_only` key's own route — each later key
   *  registered with a signature by an existing one, a revocation refused while a list or a
   *  floor needs the key. Signed by a human_only key: the tenant's registered ones and the
   *  host's BATON_HUMAN_KEYS lines. */
  private async humanKeysRoute(req: Request): Promise<Response> {
    if (!req.headers.has('X-Baton-Signed')) throw new BatonError('unauthenticated', 'sign with a human_only key (R-BTN-185)');
    const breakGlass = await this.humanBreakGlass();
    const registered = new Map(this.sql<{ fingerprint: string; public_key: string }>('SELECT fingerprint, public_key FROM human_keys WHERE revoked_at IS NULL').map((k) => [k.fingerprint, k.public_key]));
    const lookup = (fp: string) => breakGlass.get(fp) ?? registered.get(fp) ?? null;
    const signed = await this.verifySigned(req, lookup);
    if (!lookup(signed.cred)) throw new BatonError('unauthenticated', 'the key is not registered or is revoked');
    const body = await readJson(signed.req);
    return json(await this.admin.humanKeys(body, signed.cred, new Set(breakGlass.keys())));
  }

  /** A signed request (R3-1239), verified whole by the one verifier: the key its keyid names
   *  among the keys in force, the SSHSIG in the `baton-request` namespace, `created` within 5
   *  minutes of this clock — then its nonce, unseen for that key. The crypto runs outside the
   *  turn (§3); the nonce is checked and written after it. Returns the request with its body
   *  put back and the credential: the key's fingerprint. */
  private async verifySigned(req: Request, lookup: (fp: string) => string | null = (fp) => this.runners.publicKey(fp)): Promise<{ req: Request; cred: string }> {
    const now = this.now();
    const v = await this.outside(() => verifyRequest(req, lookup, { origin: this.ports.config.BATON_ORIGIN, now }));
    // R-BTN-88 (§4.8): an import sets the floor a signed request's `created` must stand above —
    // the source's `sealed_at`. A request signed at or before it is a captured one, replayed
    // against the instance its state moved to: it reaches nothing.
    const floor = this.ownerState.signCreatedFloor();
    if (floor != null && v.created <= floor) throw new BatonError('unauthenticated', 'the request was signed before this Baton\'s state was sealed and moved: sign it again (R-BTN-88)');
    // Another request ran meanwhile: the key may have been revoked since it was read.
    if (!lookup(v.keyid)) throw new BatonError('unauthenticated', 'the key is not registered or is revoked');
    this.runners.acceptNonce(v.keyid, v.nonce, now);
    return { req: withBody(req, v.body), cred: v.keyid };
  }

  /** R-BTN-13 or R-BTN-159: a signed request's key, or an API key's fingerprint — whichever the
   *  front passed — checked against `lookup`. */
  private async authenticated(req: Request, lookup?: (fp: string) => string | null): Promise<{ req: Request; cred: string }> {
    const apiKey = req.headers.get('X-Baton-Api-Key');
    if (apiKey == null) return this.verifySigned(req, lookup);
    return { req, cred: await verifyApiKey(apiKey, lookup ?? ((fp) => this.runners.publicKey(fp))) };
  }

  /** B-192: who reads — the one resolution of a read's caller into a principal. A signed
   *  request or an API key is that key's, whatever cookie came with it (the front attaches no
   *  session to one): an administrator's, an owner's or a runner's, by the key. A bearer token
   *  the front verified is a runner's. Else the dashboard session, which authorizes with its
   *  minting key's role (R-BTN-155) — an administrator's alone until B-76 builds an owner's
   *  sign-in, whose branch `canRead` (src/core/reads/kit.ts) already holds. */
  async readPrincipal(req: Request): Promise<{ principal: ReadPrincipal; req: Request }> {
    if (req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key')) {
      const admins = await this.admin.adminFingerprints();
      const v = await this.authenticated(req, (fp) => admins.get(fp) ?? this.admin.ownerKey(fp) ?? this.runners.publicKey(fp));
      const role = admins.has(v.cred) ? 'admin' : this.admin.ownerKey(v.cred) ? 'owner' : 'runner';
      return { req: v.req, principal: { kind: 'key', role, cred: v.cred } };
    }
    const cred = req.headers.get('X-Baton-Credential');
    if (cred) return { req, principal: { kind: 'key', role: 'runner', cred } };
    const session = req.headers.get('X-Baton-Session');
    if (session == null) throw new BatonError('unauthenticated', 'no principal');
    const fp = await this.admin.session(session);
    if (!fp) throw new BatonError('unauthenticated', 'the dashboard session ended or is unknown');
    return { req, principal: { kind: 'session', role: 'administrator', id: fp, repositories: null } };
  }

  /** The runner and owner routes of R3-1211. The front passes the principal in
   *  `X-Baton-Credential` (a bearer token's credential, verified), `X-Baton-Signed` (a signed
   *  request's keyid, pre-checked; verifySigned finishes it here) or `X-Baton-Owner` (the Access
   *  email); it strips all of them from every incoming request first. */
  private async runnerRoute(req: Request, url: URL, owner: string | null): Promise<Response | null> {
    const p = url.pathname;
    const m = req.method;
    let cred = req.headers.get('X-Baton-Credential');
    const currentSecret = req.headers.get('X-Runner-Secret');
    const legacySecret = req.headers.get('X-Worker-Secret');
    if (currentSecret != null && legacySecret != null && currentSecret !== legacySecret) {
      throw new BatonError('invalid-params', 'X-Runner-Secret and X-Worker-Secret differ');
    }
    const secret = currentSecret ?? legacySecret;
    const legacyName = legacySecret != null;
    if (req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key')) {
      // R-BTN-13 as amended: the front checked the request's shape, @authority and digest; the
      // key, the signature and the clock are checked here, and the nonce in this turn. An API
      // key (R-BTN-159) is checked against the public line its grant registered.
      ({ req, cred } = await this.authenticated(req));
      // One role per key (R-BTN-57): a key in BATON_ADMIN_KEYS is never a runner's, even one
      // granted before it was listed.
      if ((await this.admin.adminFingerprints()).has(cred)) throw new BatonError('forbidden', 'an administrator key is never a runner key (R-BTN-57)');
    }
    const tx = <T>(f: () => T): T => this.store.transaction(f);
    // The stats and the conditions list (§14) are served in src/core/reads/repository.ts (B-192).
    if (p.startsWith('/v1/runner/')) {
      if (!cred) throw new BatonError('unauthenticated', 'no runner principal');
      // R-BTN-197: every runner call records its Baton-Client as the runner's own statement of
      // its version (§13.3), with the heartbeat and with the secret-authenticated calls alike.
      const client = clientVersionOf(req.headers.get(CLIENT_HEADER));
      if (m === 'POST' && p === '/v1/runner/heartbeat') {
        const body = await readJson(req);
        // The hashing is async; the writes happen in one transaction after it (§3: atomic).
        return json(await this.runners.heartbeat(cred, secret, body, client, legacyName));
      }
      const view = p.slice('/v1/runner/'.length);
      if (m === 'GET' && (view === 'fleet' || view === 'instances' || view === 'launch-candidates')) {
        const credential = this.runners.credential(cred);
        if (credential.kind !== 'runner' || !req.headers.has('X-Baton-Signed')) throw new BatonError('forbidden', 'the view requires a machine key');
        const scope = this.claims.viewScope(cred);
        const repository = view === 'fleet' ? checkRepositoryId(url.searchParams.get('repository')) : null;
        if (repository) requireFleetScope(repository, scope);
        return runnerViewResponse(this.store, this.now(), req, scope, view, repository, () =>
          repository ? this.claims.fleetView(repository, scope, this.queues.all(repository))
            : view === 'instances' ? this.claims.instanceView(scope, this.resources) : this.claims.launchCandidates(scope));
      }
      if (m === 'GET' && p === '/v1/runner/mode') {
        await this.runners.authRunner(cred, secret, client, legacyName);
        // §11: `?repository=` — each repository cuts over on its own (R-BTN-28). R-BTN-47
        // (B-173): a retired one is as one never registered.
        const repo = checkRepositoryId(url.searchParams.get('repository'));
        if (!this.registry.live(repo)) throw new BatonError('invalid-params', 'repository: must be a registered repository id');
        return json(this.runners.mode(repo));
      }
      if (m === 'GET' && p === '/v1/runner/branch-holder') {
        // §6.3: a push to an item branch asks who holds the tickets it maps to; machine key alone,
        // or with a secret so the caller's own claim is not "another".
        // A pre-push hook has git's spellings: refs/heads/<branch> and owner/name.git.
        const gitRepo = (url.searchParams.get('repo') ?? '').replace(/\.git$/, '');
        const branch = (url.searchParams.get('branch') ?? '').replace(/^refs\/heads\//, '');
        if (!GIT_REPO.test(gitRepo)) throw new BatonError('invalid-params', 'repo: must be owner/name');
        if (!GIT_BRANCH.test(branch)) throw new BatonError('invalid-params', 'branch: must be a branch name');
        const caller = secret ? await this.runners.authRunner(cred, secret, client, legacyName) : null;
        return json(this.claims.branchHolder(caller, gitRepo, branch));
      }
      const holder = /^\/v1\/runner\/tickets\/([^/]+)\/holder$/.exec(p);
      if (m === 'GET' && holder) {
        // R-BTN-7: callable with the token alone (the witness has no sidecar); with a secret, the
        // caller's own claim is not "another".
        const item = this.ticketParam(holder[1]);
        const caller = secret ? await this.runners.authRunner(cred, secret, client, legacyName) : null;
        return json(this.claims.holder(caller, item));
      }
      const runnerId = await this.runners.authRunner(cred, secret, client, legacyName);
      if (m === 'POST' && p === '/v1/runner/claim') {
        const body = await readJson(req);
        // B-127 (round 2, the pairing): the claim and the standing signed-control record are
        // read in ONE transaction, and the record it paired with is stored on the claim — the
        // answer serves the claim's own record, and a lost-response replay of the same
        // request_id serves the same pairing again, whatever the board has moved to since.
        // The old code read the record after the claim's transaction (an async hop away, for
        // the owner keys), so a post accepted in between paired the claim's snapshot with the
        // newer post's record, and the runner's own checks (a keyless read must be the
        // snapshot itself; a signed read must be its ancestor) burned the honest claim as
        // `cannot-finish:spec`, a counted, non-retryable attempt, where the stale board's
        // release is unpenalised.
        const answer = tx(() => {
          const a = this.claims.claim(runnerId, body);
          const ticket = String(a.ticket_id ?? '');
          if (ticket.includes(':')) {
            const standing = this.sql<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', repositoryOf(ticket))[0];
            // Set once: a replay keeps the pairing the claim was made with, never the moved
            // board's (an empty string is the no-record shape, never NULL). Round 4: stored on
            // every claim, whatever the setting — stored only while it was on, a claim made
            // with it off and replayed after the owner turned it on backfilled the moved
            // board's record beside the old snapshot, and the runner refused the honest claim.
            // `claimControl` still answers `{}` unless the repository requires signed control.
            this.store.exec('UPDATE claims SET control_json = ? WHERE id = ? AND control_json IS NULL', standing?.control_json ?? '', Number(a.claim_id));
          }
          return a;
        });
        return json({ ...answer, ...await this.claimControl(String(answer.ticket_id ?? ''), Number(answer.claim_id ?? 0)) });
      }
      if (m === 'GET' && p === '/v1/runner/next') return json(this.claims.next(runnerId));
      if (m === 'GET' && p === '/v1/runner/recommendations') {
        // §11: `?limit=`, default 10, applied after the merge (R-BTN-61).
        const raw = url.searchParams.get('limit');
        const limit = raw == null ? 10 : Number(raw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BatonError('invalid-params', 'limit: must be an integer from 1 to 50');
        return json(this.claims.recommendations(runnerId, limit, url.searchParams.get('all') === '1'));
      }
      const advance = /^\/v1\/runner\/claims\/(\d+)\/advance$/.exec(p);
      if (m === 'POST' && advance) {
        const body = await readJson(req);
        return json(tx(() => this.claims.advance(runnerId, Number(advance[1]), body)));
      }
      if (m === 'POST' && p === '/v1/runner/adopt') {
        const body = await readJson(req);
        return json(tx(() => this.cutover.adopt(runnerId, body)));
      }
      const end = /^\/v1\/runner\/claims\/(\d+)\/end$/.exec(p);
      if (m === 'POST' && end) {
        const body = await readJson(req);
        // R-BTN-126 (round 1 B9, round 2 r2-5): a blocked end's ref must be a well-formed
        // capability the runner declares — judged before the request's transaction, so the
        // invalid end's recording (a failed attempt, ended transient) commits whether or not
        // the answer is the error.
        const prereq = (body as { prerequisite?: { kind?: string; ref?: unknown } }).prerequisite;
        if ((body as { end_reason?: string }).end_reason === 'released:blocked' && prereq?.kind === 'capability') {
          if (typeof prereq.ref !== 'string' || !CAPABILITY_NAME.test(prereq.ref)) throw new BatonError('invalid-params', 'prerequisite: must be a capability name (R-BTN-126)');
          const declared = this.sql('SELECT 1 FROM runner_capabilities wc JOIN claims c ON c.runner_id = wc.runner_id WHERE c.id = ? AND c.runner_id = ? AND wc.capability = ?', Number(end[1]), runnerId, prereq.ref);
          if (!declared.length) {
            this.store.transaction(() => this.claims.invalidPrerequisiteEnd(runnerId, Number(end[1]), prereq.ref as string));
            throw new BatonError('invalid-prerequisite', `prerequisite: ${prereq.ref} is not a capability this runner declares (R-BTN-126)`);
          }
        }
        return json(tx(() => this.claims.end(runnerId, Number(end[1]), body)));
      }
      // B-234 (R-BTN-160, R-BTN-195): the report a runner sends for each raise its channel
      // check passed. One transaction, like the advance and the end: the condition's row, its
      // event and its history row land together, and an `interact` closes the open one of the
      // same run in it.
      const conditions = /^\/v1\/runner\/claims\/(\d+)\/conditions$/.exec(p);
      if (m === 'POST' && conditions) {
        const body = await readJson(req);
        return json(tx(() => this.conditions.report(runnerId, Number(conditions[1]), body)));
      }
      if (m === 'POST' && p === '/v1/runner/readings') {
        // R-BTN-76, R-BTN-101: what a leg met — on its own runner instances and on any account
        // instance listing a repository its key works on.
        const body = await readJson(req);
        return json(this.resources.post({ kind: 'runner', runnerId, credential: cred }, body, this.grantedRepos(cred)));
      }
      if (m === 'POST' && p === '/v1/runner/activities') {
        const body = await readJson(req);
        return json(this.runners.activities(runnerId, body));
      }
      const ack = /^\/v1\/runner\/messages\/(\d+)\/ack$/.exec(p);
      if (m === 'POST' && ack) {
        // An absent body is an acknowledgement with no reply; a malformed one is refused.
        const body = req.headers.get('Content-Length') === '0' || !req.body ? null : await readJson(req);
        return json(tx(() => this.runners.ack(runnerId, Number(ack[1]), body)));
      }
      if (m === 'POST' && p === '/v1/runner/shadow-report') {
        const body = await readJson(req);
        return json(tx(() => this.runners.shadowReport(runnerId, body)));
      }
      return null;
    }
    if (p.startsWith('/v1/ui/') && m === 'POST') {
      if (!owner) throw new BatonError('unauthenticated', 'no owner principal');
      if (p === '/v1/ui/messages') {
        const body = await readJson(req);
        return json(tx(() => this.runners.sendMessage(owner, body)));
      }
      const reap = /^\/v1\/ui\/claims\/(\d+)\/reap$/.exec(p);
      if (reap) {
        const body = await readJson(req);
        return json(tx(() => this.claims.forceReap(owner, Number(reap[1]), body)));
      }
      // R-BTN-19: an administrator's fence clear, in one transaction with its seats' release
      // (R-BTN-178) and its event. A dashboard session's principal is an administrator's — the
      // only key a session is minted from — so the route itself needs no further check.
      const fenceClear = /^\/v1\/ui\/claims\/(\d+)\/fence-clear$/.exec(p);
      if (fenceClear) {
        const body = await readJson(req);
        return json(tx(() => this.claims.fenceClear(owner, Number(fenceClear[1]), body)));
      }
      // B-222 (R-BTN-10, §9.6): the completion's confirm and its release, each a route of its
      // own over `claims.resolve`. V1's one route taking `{action}` is retired (B-203).
      const completion = /^\/v1\/ui\/claims\/(\d+)\/(confirm|release)$/.exec(p);
      if (completion) {
        const body = await readJson(req);
        // `confirm` is the caller's own word (§12.2): `checkResolve` refuses a body without it.
        const confirm = (body as { confirm?: unknown } | null)?.confirm;
        return json(tx(() => this.claims.resolve(owner, Number(completion[1]), { action: completion[2], confirm })));
      }
      if (p === '/v1/ui/cutover') {
        const body = await readJson(req);
        return json(tx(() => this.cutover.cutover(owner, body)));
      }
      const adoption = /^\/v1\/ui\/adoptions\/([^/]+)\/confirm$/.exec(p);
      if (adoption) {
        const ticket = this.ticketParam(adoption[1]);
        const body = await readJson(req);
        return json(tx(() => this.cutover.confirmAdoption(owner, ticket, body)));
      }
      const override = /^\/v1\/ui\/overrides\/([^/]+)$/.exec(p);
      if (override) {
        const ticket = this.ticketParam(override[1]);
        const body = await readJson(req);
        return json(tx(() => this.claims.setOverride(owner, ticket, body)));
      }
      // B-134: an owner resolves a scope finding — the acknowledgement that it was looked at.
      // In the transaction, like every neighbouring `/v1/ui` mutation, so the resolution and
      // its `scope-resolved` event land together.
      const finding = /^\/v1\/ui\/scope\/(\d+)\/resolve$/.exec(p);
      if (finding) {
        const id = Number(finding[1]);
        return json(tx(() => {
          if (!this.scope.resolve(id, `owner:${owner}`)) throw new BatonError('not-found', `no open scope finding ${id}`);
          return { ok: true };
        }));
      }
      if (p === '/v1/ui/board/accept') {
        const body = await readJson(req);
        return json(tx(() => this.claims.acceptHeld(owner, body)));
      }
      // B-201 (`repo.resync`; R-BTN-73): a session asks the repository's sync to run now — the
      // dispatch a webhook delivery sends, logged with who asked, at most one per repository per
      // dispatch window. Nothing of the board moves here: the sync posts, and R-BTN-11 judges
      // its post. A forced resync is not built and is refused by name (`checkResync`).
      if (p === '/v1/ui/resync') {
        const { repository } = checkResync(await readJson(req));
        const repo = this.registry.live(repository);
        if (!repo) throw new BatonError('forbidden', 'this repository is not yours or does not exist');
        if (!repo.sync_workflow) throw new BatonError('conflict', `${repository} registers no sync workflow: Baton has nothing to dispatch for it`);
        tx(() => {
          const now = this.now();
          // The request is an `admin` event (`act: resync`), as an administrator's other acts are:
          // the window reads the last one, so no new event kind and no table is needed.
          const last = this.sql<{ at: number }>(
            `SELECT at FROM events WHERE kind = 'admin' AND at > ? AND repository_id = ? AND json_extract(detail_json, '$.act') = 'resync' ORDER BY at DESC, seq DESC LIMIT 1`,
            now - RESYNC_WINDOW_MS, repository)[0];
          if (last) throw new BatonError('conflict', `a resync of ${repository} was asked for under ${RESYNC_WINDOW_MS / 1000} seconds ago`);
          logEvent(this.store, now, 'admin', `owner:${owner}`, { act: 'resync' }, null, null, repository);
        });
        this.syncNow([repository]);
        return json({ ok: true });
      }
    }
    return null;
  }

  /**
   * `/v1/admin/*` and `/v1/owner/{repository}/*` (R-BTN-57, R-BTN-58, §11): signed by an
   * administrator's key (BATON_ADMIN_KEYS) or by an owner key of that repository. A key Baton
   * does not know is `unauthenticated`; a known key outside its role or repository `forbidden`.
   */
  private async adminRoute(req: Request, url: URL): Promise<Response> {
    const apiKey = req.headers.get('X-Baton-Api-Key');
    if (!req.headers.has('X-Baton-Signed') && apiKey == null) throw new BatonError('unauthenticated', 'sign with an administrator or owner key, or send its API key');
    const admins = await this.admin.adminFingerprints();
    const lookup = (fp: string) => admins.get(fp) ?? this.admin.ownerKey(fp);
    // R-BTN-159: a person's API key, checked against its public line, in place of a signature.
    const signed = await this.authenticated(req, lookup);
    const fp = signed.cred;
    const p = url.pathname;
    const m = req.method;
    const body = async () => readJson(signed.req);
    const seg = pathSegment;
    if (p.startsWith('/v1/admin/')) {
      if (!admins.has(fp)) throw new BatonError('forbidden', 'an administrator’s key is required (R-BTN-57)');
      const actor = `admin:${fp}`;
      // `GET /v1/admin/repositories` and `GET /v1/admin/capacities` are reads of
      // src/core/reads/tenant.ts (B-202), answered before this route is reached.
      // B-118, B-216 (R-BTN-57, R-BTN-179): the state in one request for a terminal —
      // `stateView()`, built by the functions the entity reads use, so the two cannot drift.
      if (m === 'GET' && p === '/v1/admin/state') return json(this.stateView());
      if (m === 'POST' && p === '/v1/admin/repositories') return json(await this.admin.repositories(actor, await body()));
      if (m === 'POST' && p === '/v1/admin/probes') return json(await this.admin.addProbe(actor, await body()));
      // R-BTN-76: external resources, their account instances, and a reading by hand.
      if (m === 'POST' && p === '/v1/admin/resources') return json(this.resources.addResource(actor, await body()));
      if (m === 'POST' && p === '/v1/admin/instances') return json(this.resources.addInstance(actor, await body()));
      if (m === 'POST' && p === '/v1/admin/readings') {
        const b = await body();
        // R-BTN-76, R-BTN-151: a reading, or `{instance, clear}` to end the readings in force there.
        if (b && typeof b === 'object' && !Array.isArray(b) && (b as { clear?: unknown }).clear !== undefined) return json(this.resources.clear(actor, b));
        return json(this.resources.post({ kind: 'admin', fingerprint: fp }, b, null));
      }
      // R-BTN-178: a capability's capacity. The read `baton admin capacity set` prints before
      // it asks to confirm is `admin.capacity.list` (src/core/reads/tenant.ts).
      if (m === 'PUT' && p === '/v1/admin/capacities') return json(this.resources.setCapacity(actor, await body()));
      // B-4 (R-BTN-113, §13.1): the instance settings — `link_hosts`, `session_hosts` and
      // `check_app_id`, each given replacing its own whole.
      if (m === 'PUT' && p === '/v1/admin/settings') return json(this.instance.set(actor, await body()));
      // R-BTN-88 (§4.8, R3-1258): the move — freeze, unfreeze, seal, export, import. An
      // administrator's alone, and the writes a freeze refuses do not touch them: the
      // administrator drives the move through it.
      if (m === 'POST' && p === '/v1/admin/freeze') return json(this.store.transaction(() => this.ownerState.freeze(actor)));
      if (m === 'POST' && p === '/v1/admin/unfreeze') return json(this.store.transaction(() => this.ownerState.unfreeze(actor)));
      if (m === 'POST' && p === '/v1/admin/seal') {
        // §4.8: a refused seal still dispatches the lagging mirrors' workflows (R-BTN-94) — the
        // dispatch the seal asked for goes out with the refusal, so the mirrors catch up and the
        // administrator can seal once they have.
        try {
          return json(this.store.transaction(() => this.ownerState.seal(actor)));
        } catch (e) {
          if (e instanceof BatonError) this.flushDispatch();
          throw e;
        }
      }
      if (m === 'GET' && p === '/v1/admin/export') return json(this.ownerState.export(url.searchParams.get('with_history') === '1'));
      if (m === 'POST' && p === '/v1/admin/import') {
        const b = await body();
        return json(await this.ownerState.import(actor, b, new Set((await this.admin.adminFingerprints()).keys())));
      }
      if (m === 'POST' && p === '/v1/admin/grants') {
        const b = await body();
        const repo = checkRepositoryId((b as { repository?: unknown } | null)?.repository);
        return json(await this.admin.grant(actor, repo, b, 'admin'));
      }
      const revoke = /^\/v1\/admin\/keys\/([^/]+)\/revoke$/.exec(p);
      if (m === 'POST' && revoke) return json(await this.admin.revokeKey(actor, seg(revoke[1])));
      if (m === 'POST' && p === '/v1/admin/login-links') return json(await this.admin.loginLink(fp));
      throw new BatonError('not-found', `no route ${m} ${p}`);
    }
    const o = /^\/v1\/owner\/([^/]+)\/(.+)$/.exec(p);
    if (!o) throw new BatonError('not-found', `no route ${m} ${p}`);
    const repo = checkRepositoryId(seg(o[1]));
    // R-BTN-47 (B-173): one check for every route naming a repository — a retired one is
    // `not-found`, as one never registered, whoever asks.
    if (!this.registry.live(repo)) throw new BatonError('not-found', `${repo} is not registered`);
    // An administrator's key is no owner's, even one added as an owner before it was listed (R-BTN-57).
    if (admins.has(fp)) throw new BatonError('forbidden', 'an administrator key is never an owner key (R-BTN-57)');
    // Owning one repository confers nothing on another (R-BTN-58).
    if (!this.admin.owns(fp, repo)) throw new BatonError('forbidden', `this key does not own ${repo}`);
    const actor = `owner:${fp}`;
    const rest = o[2];
    // B-90: the repository's grants and settings — and the policy's log below — are read in
    // src/core/reads/repository.ts (B-192: a session's reads too).
    // B-127: the repository's owner signing keys — public keys of its human-only owners — the
    // read `baton owner verify-config` carries into a checkout (the same list the sync's
    // observation serves its own credential).
    if (m === 'GET' && rest === 'signing-keys') return json({ keys: await this.admin.signingKeys(repo) });
    if (m === 'POST' && rest === 'grants') return json(await this.admin.grant(actor, repo, await body(), 'owner'));
    const rg = /^grants\/([^/]+)\/revoke$/.exec(rest);
    if (m === 'POST' && rg) return json(await this.admin.revokeGrant(actor, repo, seg(rg[1])));
    if (m === 'POST' && rest === 'owners') return json(await this.admin.owners(actor, repo, await body()));
    // B-113 (R-BTN-140's precedent): the repository's owners' consent to another repository's
    // tickets depending on theirs — the consent a dependency on a less visible repository needs
    // (§3.1). Given here, never by the dependent's own settings; `{withdraw: true}` takes it back.
    if (m === 'POST' && rest === 'dependency-consents') return json(consentRoute(this.store, () => this.now(), repo, actor, await body()));
    if (m === 'POST' && rest === 'bars') return json(this.admin.setBar(actor, repo, await body()));
    const lift = /^bars\/(\d+)\/lift$/.exec(rest);
    if (m === 'POST' && lift) return json(this.admin.liftBar(actor, repo, Number(lift[1])));
    if (m === 'PUT' && rest === 'settings') return json(await this.admin.setSettings(actor, repo, await body()));
    if (m === 'POST' && rest === 'couriers') return json(await this.admin.couriers(actor, repo, await body()));
    // §12.8 (B-145): the repository policy's routes (R-BTN-188, R-BTN-189). A change is one
    // transaction — the compare-and-set, the approver check against the list in force, the
    // floors and the satisfiable-list refusals all inside it.
    if (m === 'PUT' && rest === 'policy') {
      const repoRow = this.registry.get(repo);
      if (!repoRow || repoRow.retired_at != null) throw new BatonError('not-found', `${repo} is not registered`);
      const b = await body();
      const breakGlass = await this.humanBreakGlass();
      return json(this.store.transaction(() => this.policies.put(repo, b, repoRow.forge, { credential: fp, label: actor }, new Set(breakGlass.keys()))));
    }
    if (m === 'POST' && rest === 'policy/floors') {
      const b = await body();
      const breakGlass = await this.humanBreakGlass();
      return json(this.store.transaction(() => this.policies.floorsRoute(repo, b, { credential: fp, label: actor }, new Set(breakGlass.keys()))));
    }
    const resolve = /^tickets\/([^/]+)\/resolve$/.exec(rest);
    if (m === 'POST' && resolve) {
      // R-BTN-78: an owner answers one of Baton's own decisions on a ticket of this repository.
      // A local id is this repository's, as the repository reads take it (§11).
      const raw = seg(resolve[1]);
      const ticket = raw.includes(':') ? raw : qualify(repo, raw);
      if (!TICKET_ID.test(ticket) || repositoryOf(ticket) !== repo) throw new BatonError('invalid-params', `ticket: must be a ticket of ${repo}`);
      const b = await body();
      return json(this.store.transaction(() => this.claims.resolveDecision(fp, ticket, b)));
    }
    throw new BatonError('not-found', `no route ${m} ${p}`);
  }

  /**
   * `/v1/courier/*` (R-BTN-80, R-BTN-103, §11): signed by a personal courier's key, or by a machine
   * key naming `?repository=` — granted there, its sessions having declared `couriers` for it within
   * the day — acting as a runner courier on that repository's pool, with no runner secret. A key in
   * any other role is `forbidden`.
   */
  private async courierRoute(req: Request, url: URL): Promise<Response> {
    if (!req.headers.has('X-Baton-Signed')) throw new BatonError('unauthenticated', 'sign with a courier key or a machine key (R-BTN-13)');
    const signed = await this.verifySigned(req);
    const fp = signed.cred;
    if ((await this.admin.adminFingerprints()).has(fp)) throw new BatonError('forbidden', 'an administrator key is never a courier key (R-BTN-57)');
    const cred = this.sql<{ kind: string; created_by: string | null }>('SELECT kind, created_by FROM credentials WHERE id = ?', fp)[0];
    const raw = url.searchParams.get('repository');
    let who: Courier;
    if (cred?.kind === 'courier') {
      if (raw != null) throw new BatonError('invalid-params', 'repository: only a machine key names one; a courier key claims its own notices');
      who = { kind: 'personal', fingerprint: fp };
    } else if (cred?.kind === 'runner') {
      if (raw == null) throw new BatonError('invalid-params', 'repository: a machine key delivers one repository’s pool at a time (R-BTN-103)');
      const repository = checkRepositoryId(raw);
      if (!this.sql('SELECT 1 FROM runner_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', fp, repository).length) {
        throw new BatonError('forbidden', `the key is not granted on ${repository} (R-BTN-58)`);
      }
      const asks = this.notices.runnerAsks(fp, repository);
      if (!asks.length) throw new BatonError('forbidden', `no session of this key declared couriers for ${repository} within the day (R-BTN-103)`);
      who = { kind: 'runner', fingerprint: fp, repository, asks };
    } else throw new BatonError('forbidden', 'only a courier key or a machine key delivers notices (R-BTN-57)');
    const p = url.pathname;
    const m = req.method;
    const tx = <T>(f: () => T): T => this.store.transaction(f);
    if (m === 'POST' && p === '/v1/courier/notices/claim') {
      const body = signed.req.headers.get('Content-Length') === '0' || !signed.req.body ? null : await readJson(signed.req);
      const limit = checkNoticeClaim(body);
      return json(tx(() => this.notices.claim(who, limit)));
    }
    const mark = /^\/v1\/courier\/notices\/([^/]+)$/.exec(p);
    if (m === 'POST' && mark) {
      const body = await readJson(signed.req);
      return json(tx(() => this.notices.mark(who, mark[1], body)));
    }
    if (m === 'GET' && p === '/v1/courier/decisions') return json(this.notices.decisions(who));
    throw new BatonError('not-found', `no route ${m} ${p}`);
  }

  /** The repositories a runner key works on (R-BTN-58), or null for a key no owner or
   *  administrator granted — a bearer token or a seed key, which reaches every one. */
  private grantedRepos(cred: string): string[] | null {
    if (!this.runners.credential(cred).granted) return null;
    return this.sql<{ repository_id: string }>('SELECT repository_id FROM runner_grants WHERE credential_id = ? AND revoked_at IS NULL', cred).map((r) => r.repository_id);
  }

  /**
   * `GET /v1/repositories/{repository}/tickets/{ticket}/blocks[?runner=me]` and
   * `GET /v1/repositories/{repository}/blocked[?on=…&transitive=1 | ?cursor=…]` (R-BTN-75, §11):
   * for any key granted on the repository, an owner of it, or an administrator. `runner=me` is a
   * runner session's own answer, so it needs the session's secret. B-192: served through
   * src/core/reads/repository.ts, for a session beside those keys.
   */
  async repositoryRead(req: Request, url: URL, repo: string, who: ReadPrincipal): Promise<Response | null> {
    const blocks = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/blocks$/.exec(url.pathname);
    const blocked = /^\/v1\/repositories\/([^/]+)\/blocked$/.exec(url.pathname);
    // R-BTN-81: a ticket's history, read by the principals that may read its blocks (§11).
    const history = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/history$/.exec(url.pathname);
    // B-190 (R-BTN-84, §14): one leg's runs of a ticket, with the inputs replay reads — an
    // owner's or an administrator's read (§11's command tree), never a runner's.
    const runs = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/legs\/([^/]+)\/runs$/.exec(url.pathname);
    // R-BTN-194 (B-126): the ticket itself — its filter fields, where it is, who last pushed it
    // and its brief mark — for the same principals; `baton ticket show` prints the provenance first.
    const show = !blocks && !history && !runs ? /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)$/.exec(url.pathname) : null;
    // R-BTN-86 (§4.6, R3-1258): a ticket's children, open and closed, with station and blocked
    // state — the same principals that read its blocks.
    const children = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/children$/.exec(url.pathname);
    // B-90: the dashboard's view of one repository, for the same principals — an administrator
    // sees any, an owner its own, a granted key the repositories it is granted on.
    const boardRead = /^\/v1\/repositories\/([^/]+)\/board$/.exec(url.pathname);
    // §12.8 (B-145, R-BTN-189): the policy read, for the same principals.
    const policyRead = /^\/v1\/repositories\/([^/]+)\/policy$/.exec(url.pathname);
    if (!blocks && !blocked && !history && !show && !boardRead && !policyRead && !runs && !children) return null;
    const seg = pathSegment;
    // B-192: the caller is resolved and authorized before this is reached (src/core/reads/) —
    // `repo` is live and the principal's to read; a session reads as its role's key does, with
    // no grant of its own and no runner's secret.
    const role: 'admin' | 'owner' | 'runner' = who.kind === 'session' ? (who.role === 'administrator' ? 'admin' : 'owner') : who.role;
    const cred = who.kind === 'session' ? who.id : who.cred;
    // B-190 (§14): a leg's runs are what replay reads — an owner's or an administrator's read.
    if (runs && role === 'runner') throw new BatonError('forbidden', `a leg's runs are an owner's or an administrator's read, not a runner's (R-BTN-84)`);
    // R-BTN-179 (B-90): a granted key's board names its grant on THIS repository — the same grant the
    // heartbeat's answer names for it (runnerApi.grantedCapabilities), 'none' left out — and
    // null for a key no grant binds there (a bearer's or a seed key's reach is its own).
    let granted: string[] | null = null;
    if (role === 'runner') {
      const c = this.runners.credential(cred);
      granted = c.granted
        ? [...new Set(this.runners.grantedCapabilities(cred, repo))].filter((x) => x !== 'none').sort()
        : null;
    }
    if (boardRead) return json(this.boardView(repo, granted));
    if (policyRead) return this.policyRead(repo);
    if (show) {
      const raw = seg(show[2]);
      const id = raw.includes(':') ? raw : qualify(repo, raw);
      if (!TICKET_ID.test(id) || repositoryOf(id) !== repo) throw new BatonError('invalid-params', `ticket: must be a ticket of ${repo}`);
      const out = this.claims.ticketView(id);
      if (!out) throw new BatonError('not-found', `${id} is not on the board`);
      return json(out);
    }
    // R-BTN-86 (§4.6, R3-1258): the children of a ticket, open and closed — each open one's
    // station and whether a block holds it, each closed one's closure. An open child blocks
    // its parent only through a call (B-62): nothing here computes one.
    if (children) {
      const raw = seg(children[2]);
      const id = raw.includes(':') ? raw : qualify(repo, raw);
      if (!TICKET_ID.test(id) || repositoryOf(id) !== repo) throw new BatonError('invalid-params', `ticket: must be a ticket of ${repo}`);
      const open = this.sql<{ id: string; station: string | null }>(
        `SELECT t.id, s.station FROM tickets t LEFT JOIN ticket_stations s ON s.ticket_id = t.id
         WHERE t.repository_id = ? AND t.parent = ? ORDER BY t.id`, repo, id);
      const blockedSet = new Set(this.sql<{ ticket_id: string }>(
        `SELECT DISTINCT ticket_id FROM ticket_blocks WHERE ticket_id >= ? || ':' AND ticket_id < ? || ';'`, repo, repo).map((x) => x.ticket_id));
      const closed = this.sql<{ ticket_id: string; closed_as: string; closed_at: number }>(
        `SELECT ticket_id, closed_as, closed_at FROM closed_tickets
         WHERE ticket_id >= ? || ':' AND ticket_id < ? || ';' AND parent = ? ORDER BY ticket_id`, repo, repo, id);
      return json({
        children: [
          ...open.map((c) => ({ ticket_id: c.id, station: c.station, blocked: blockedSet.has(c.id) })),
          ...closed.map((c) => ({ ticket_id: c.ticket_id, station: null, blocked: false, closed: { as: c.closed_as, closed_at: c.closed_at } })),
        ],
      });
    }
    if (history) {
      const raw = seg(history[2]);
      const id = raw.includes(':') ? raw : qualify(repo, raw);
      if (!TICKET_ID.test(id) || repositoryOf(id) !== repo) throw new BatonError('invalid-params', `ticket: must be a ticket of ${repo}`);
      const before = url.searchParams.get('before');
      const limit = url.searchParams.get('limit');
      const b = before == null ? null : Number(before);
      const n = limit == null ? 50 : Number(limit);
      if (b != null && !(Number.isInteger(b) && b > 0)) throw new BatonError('invalid-params', 'before: must be the next_before a page gave');
      if (!(Number.isInteger(n) && n >= 1 && n <= HISTORY_PAGE_MAX)) throw new BatonError('invalid-params', `limit: must be an integer from 1 to ${HISTORY_PAGE_MAX}`);
      // B-129: the ended claims' branches and PRs ride with the path (R-BTN-24's records,
      // pruned) — the PR a ticket's frontmatter lost, so a claimant continues the change.
      return json({ ...this.history.list(id, b, n), resume: this.claims.resumeOf(id) });
    }
    if (runs) {
      const raw = seg(runs[2]);
      const id = raw.includes(':') ? raw : qualify(repo, raw);
      if (!TICKET_ID.test(id) || repositoryOf(id) !== repo) throw new BatonError('invalid-params', `ticket: must be a ticket of ${repo}`);
      const leg = seg(runs[3]);
      if (!COURSE_ID.test(leg)) throw new BatonError('invalid-params', 'leg: must be a leg id');
      return json(this.claims.runsOf(id, leg));
    }
    if (blocks) {
      const raw = seg(blocks[2]);
      const id = raw.includes(':') ? raw : qualify(repo, raw);
      if (!TICKET_ID.test(id) || repositoryOf(id) !== repo) throw new BatonError('invalid-params', `ticket: must be a ticket of ${repo}`);
      let runner: number | null = null;
      const currentWho = url.searchParams.get('runner');
      const legacyWho = url.searchParams.get('worker');
      if (currentWho != null && legacyWho != null && currentWho !== legacyWho) throw new BatonError('invalid-params', 'runner and worker differ');
      const who = currentWho ?? legacyWho;
      if (who != null) {
        if (who !== 'me' || role !== 'runner') throw new BatonError('invalid-params', 'runner: only `me`, from a runner session');
        const currentSecret = req.headers.get('X-Runner-Secret');
        const legacySecret = req.headers.get('X-Worker-Secret');
        if (currentSecret != null && legacySecret != null && currentSecret !== legacySecret) throw new BatonError('invalid-params', 'X-Runner-Secret and X-Worker-Secret differ');
        runner = await this.runners.authRunner(cred, currentSecret ?? legacySecret, clientVersionOf(req.headers.get(CLIENT_HEADER)), legacyWho != null || legacySecret != null);
      }
      return json(this.blocks.blocksOf(id, runner));
    }
    const on = url.searchParams.get('on');
    if (on == null) {
      const cursor = url.searchParams.get('cursor');
      if (cursor != null && !(TICKET_ID.test(cursor) && repositoryOf(cursor) === repo)) throw new BatonError('invalid-params', 'cursor: must be the next_cursor a page gave');
      return json(this.blocks.blockedAll(repo, cursor));
    }
    const t = url.searchParams.get('transitive');
    if (t != null && t !== '1' && t !== '0') throw new BatonError('invalid-params', 'transitive: must be 1 or 0');
    return json(this.blocks.blockedOn(repo, checkBlockedOn(on), t === '1'));
  }

  /**
   * `POST /v1/repositories/{repository}/sequences/{kind}/next` (§4.3, B-176, R-BTN-199): the
   * next number of a repository's sequence, for the principals that file tickets today — a key
   * granted on the repository (the runner role), an owner of it, an administrator, the
   * repository's sync key, and a delegated key (a number is not authority, and issuing one more
   * than needed only leaves a gap). The caller's `floor` seeds and guards the sequence; `for` is
   * recorded, never trusted.
   */
  private async sequenceRoute(req: Request, url: URL): Promise<Response | null> {
    const m = /^\/v1\/repositories\/([^/]+)\/sequences\/([^/]+)\/next$/.exec(url.pathname);
    if (!m || req.method !== 'POST') return null;
    const seg = pathSegment;
    const repo = checkRepositoryId(seg(m[1]));
    // R-BTN-47 (B-173): a retired repository is `not-found`, as one never registered.
    if (!this.registry.live(repo)) throw new BatonError('not-found', `no repository ${repo}`);
    const kind = seg(m[2]);
    if (!SEQUENCE_KIND.test(kind)) throw new BatonError('invalid-params', 'kind: must match ' + SEQUENCE_KIND);
    // The same principals the repository's reads take (blocksRoute), with the repository's sync
    // key beside them: a sync credential files tickets too, and its key is never a runner's.
    // A runner's key on EITHER path — signed, an API key, or the transition's bearer token
    // (front.ts's verifyRunner) — takes numbers only where R-BTN-58's grant binds it, exactly as
    // blocksRoute checks the same path (review round 1, finding 1: the bearer once skipped it).
    let cred = req.headers.get('X-Baton-Credential');
    let actor = `runner:${cred ?? ''}`;
    let runnerKey = true;
    if (req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key')) {
      const admins = await this.admin.adminFingerprints();
      // The signed request's body is put back by the verifier: read it from the returned request.
      const v = await this.authenticated(req, (fp) => admins.get(fp) ?? this.admin.ownerKey(fp) ?? this.registry.syncKey(fp)?.public_key ?? this.runners.publicKey(fp));
      req = v.req;
      cred = v.cred;
      const sync = this.registry.syncKey(cred);
      if (admins.has(cred)) { actor = `admin:${cred}`; runnerKey = false; }
      else if (this.admin.ownerKey(cred)) {
        if (!this.admin.owns(cred, repo)) throw new BatonError('forbidden', `this key does not own ${repo}`);
        actor = `owner:${cred}`;
        runnerKey = false;
      } else if (sync?.role === 'sync' && sync.repository === repo) { actor = 'sync'; runnerKey = false; }
      else if (sync?.role === 'sync') throw new BatonError('forbidden', `this sync key serves ${sync.repository}, not ${repo}`);
      else if (sync) throw new BatonError('forbidden', `this key is ${sync.repository}'s ${sync.role} key, not ${repo}'s sync key`);
      else actor = `runner:${cred}`;
    }
    if (!cred) throw new BatonError('unauthenticated', 'no principal');
    if (runnerKey) {
      if (!this.sql('SELECT 1 FROM runner_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', cred, repo).length) {
        throw new BatonError('forbidden', `the key is not granted on ${repo} (R-BTN-58)`);
      }
    }
    // An empty body legitimately carries neither field; a body that is not JSON is the caller's
    // error, never "no floor, no for" (review round 1, nit 2).
    const rawBody = await req.text();
    let body: unknown = null;
    if (rawBody.trim() !== '') {
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new BatonError('invalid-params', 'the body is not JSON: an empty body carries no floor and no for');
      }
    }
    const take = checkSequenceTake(body);
    return json(this.sequences.next(repo, kind, take.floor, actor, take.forTicket));
  }

  /** A ticket in a path: a qualified id (R-BTN-47) of a registered repository. A malformed
   *  escape is the caller's error, never a 500. */
  private ticketParam(raw: string): string {
    let id = '';
    try {
      id = decodeURIComponent(raw);
    } catch {
      // falls through to the refusal
    }
    const m = TICKET_ID.exec(id);
    if (!m || !this.registry.get(m[1])) throw new BatonError('invalid-params', 'ticket: must be a ticket id, <repository>:<id>, of a registered repository');
    return id;
  }

  // ── sync (§7.1) ───────────────────────────────────────────────────────────────────────

  /** A repository's head snapshot (R-BTN-11, per repository), or null before its first. */
  private headOf(repo: string): string | null {
    return this.sql<{ sha: string | null }>('SELECT sha FROM board_head WHERE repository_id = ?', repo)[0]?.sha ?? null;
  }

  /** `GET /v1/sync/head`: the repository's head snapshot and its completions waiting for
   *  confirmation. */
  head(repo: string) {
    const unconfirmed = this.sql(
      `SELECT c.id AS claim_id, c.ticket_id, c.end_reason, c.ended_at_sha FROM claims c
       WHERE c.status = 'completed' AND c.confirmed_at IS NULL AND substr(c.ticket_id, 1, length(?) + 1) = ? || ':' ORDER BY c.id`, repo, repo);
    return { sha: this.headOf(repo), unconfirmed };
  }

  /**
   * `POST /v1/sync/board` (R-BTN-11): accepted only when `parent_sha` is the current head (or
   * null while there is none); a lost race is `head-moved`. `force` — a rewritten `main` — is
   * held for the owner as a `snapshot-rejected` event and moves nothing else; accepting it
   * is the alarm's and the dashboard's job (R3-1212). A repeat of the head is a no-op.
   *
   * `held_snapshots` holds one row per hold, against the current head (R3-1223): rows held
   * against a head are deleted when the head moves, so a later force post of the same sha —
   * a rewind to a once-accepted history included — is a fresh hold with a fresh row. The 0001
   * schema's "written once" and "the first force post" describe that one hold.
   */
  // @model syncPost sha256:231806fa206f
  async board(repo: Repository, p: BoardPayload) {
    // Course graphs are read per post: a registry applied, or a post refused after applying one,
    // must not leave another request reading a graph that is not in force.
    this.stations.reset();
    try {
      return await this.boardPost(repo, p);
    } finally {
      this.stations.reset();
    }
  }

  private async boardPost(repo: Repository, p: BoardPayload) {
    const r = repo.id;
    // R-BTN-62: the post's number is used first, whatever becomes of the post; an older reading
    // than the last accepted one, or a void or used number, is refused whole here.
    const n = p.observation;
    this.observations.use(r, n);
    // B-183 (§4.4, R-BTN-184): the `tickets-approved` guarantee is defined over a ticket file's
    // approval — a source that reads only as it is now has no file to approve, so its post to a
    // repository whose policy's floors include the guarantee is refused, naming it. What approval
    // means for a tracker source is a later ticket's.
    this.refuseCurrentUnderApprovalFloor(repo, p);
    const head = this.headOf(r);
    const at = this.now();
    const normative = p.tickets !== undefined;
    const ticketCount = normative ? p.tickets!.length : p.state!.items.length;
    // B-113 (§4.4): the post's live tickets' cross-repository `depends_on`, as the checks below
    // take them — the normative post's live ones (closed by the post is not live), the interim
    // post's items, all live. Judged inside each path's transaction, before anything is written.
    const liveDeps = normative
      ? (() => { const live = new Set(p.tickets!.map((t) => t.id)); for (const c of p.closed ?? []) live.delete(c.id); return p.tickets!.filter((t) => live.has(t.id)).map((t) => ({ id: t.id, depends_on: t.depends_on })); })()
      : p.state!.items.map((it) => ({ id: it.id, depends_on: it.dependsOn ?? [] }));
    // The interim post's confirmations (docs until R3-1233; R-BTN-10 derives them from stations
    // and closures for the normative post), only for its own repository's completions (R-BTN-47).
    const confirmations = normative ? [] : this.claims.ownConfirmations(r, checkConfirmations(p.confirmations));
    // A held history the owner (or the 24-hour clock) accepted becomes the head on its next post.
    const accepted = !!p.force && this.claims.acceptedLine(r, head);
    if (p.force && !accepted) {
      // R-BTN-62: a held post's stations, paths, next legs and closures — which no commit orders —
      // are a refresh against the current head, its number being newer, so confirmations and
      // staleness do not stall for the hold's 24 hours. Its interim confirmations likewise.
      this.store.transaction(() => {
        this.observations.accept(r, n);
        const seen = normative ? this.refreshStations(r, p, n, at, null, true) : new Map<string, Seen>();
        this.claims.confirm(confirmations, n);
        this.claims.judge(r, n, seen);
        this.store.exec('UPDATE held_snapshots SET observation = ? WHERE repository_id = ? AND sha = ?', n, r, p.sha);
      });
      // Held once per sha: a repeat (the sync re-posts every 15 minutes) changes nothing, so
      // the first deadline stands and the dashboard lists it once. Every row is a hold against
      // the current head (rows held against a head are deleted when it moves, below), so a row
      // for this sha is this hold; with none, this is a new one — including a rewind to a sha
      // the owner once accepted, whose old row went when its line became the head (R3-1223).
      const known = this.sql<{ auto_accept_at: number }>('SELECT auto_accept_at FROM held_snapshots WHERE repository_id = ? AND sha = ?', r, p.sha)[0];
      const deadline = known?.auto_accept_at ?? at + HELD_AUTO_ACCEPT_MS;
      if (!known) {
        this.store.transaction(() => {
          this.store.exec('INSERT INTO held_snapshots (repository_id, sha, parent_sha, head_sha, ticket_count, received_at, auto_accept_at, observation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            r, p.sha, p.parent_sha, head, ticketCount, at, deadline, n);
          this.event(r, 'snapshot-rejected', { sha: p.sha, parent_sha: p.parent_sha, head, ticket_count: ticketCount, auto_accept_at: deadline }, at);
        });
      }
      throw new BatonError('snapshot-rejected', `a rewritten history is held for the owner until ${new Date(deadline).toISOString()}; claims continue on the current head`);
    }
    // B-287: hash the validated reading, not its observation number. A tracker can change at
    // the same Git head. The scheduling version also invalidates this shortcut after any
    // server-side matching/position change. No incoming digest is trusted.
    const { observation: _observation, ...snapshotInputs } = p;
    const fingerprint = sha256HexSync(JSON.stringify(snapshotInputs));
    const remember = () => this.store.exec(`INSERT INTO sync_fingerprints (repository_id, digest, scheduling_v)
      VALUES (?, ?, ?) ON CONFLICT(repository_id) DO UPDATE SET digest = excluded.digest, scheduling_v = excluded.scheduling_v
      WHERE sync_fingerprints.digest IS NOT excluded.digest OR sync_fingerprints.scheduling_v IS NOT excluded.scheduling_v`,
      r, fingerprint, schedulingVersion(this.store));
    if (p.sha === head && normative && !p.force) {
      const prior = this.sql<{ digest: string; scheduling_v: number }>('SELECT digest, scheduling_v FROM sync_fingerprints WHERE repository_id = ?', r)[0];
      if (prior?.digest === fingerprint && prior.scheduling_v === schedulingVersion(this.store)) {
        return this.store.transaction(() => {
          this.observations.accept(r, n);
          // The snapshot is identical but a later observation may now confirm a completion
          // or judge a run whose observation equalled the previous snapshot's. Read only those
          // claims' placements, preserving a Baton-owned position instead of replaying git.
          const relevant = this.sql<{ ticket_id: string }>(`SELECT ticket_id FROM claims INDEXED BY claims_holding
            WHERE (status = 'active' OR (status = 'completed' AND confirmed_at IS NULL) OR (status = 'reaped' AND fence_pending = 1))
              AND ticket_id >= ? || ':' AND ticket_id < ? || ';'
            UNION SELECT c.ticket_id FROM claim_legs l INDEXED BY claim_legs_unjudged CROSS JOIN claims c ON c.id = l.claim_id
              WHERE l.bars != '[]' AND l.bars_judged = 0 AND c.ticket_id >= ? || ':' AND c.ticket_id < ? || ';'`, r, r, r, r);
          const ids = JSON.stringify(relevant.map((x) => x.ticket_id));
          const seen = new Map<string, Seen>();
          if (relevant.length) for (const st of this.sql<{ ticket_id: string; station: string; path: string }>(
            'SELECT ticket_id, station, path FROM ticket_stations WHERE ticket_id IN (SELECT value FROM json_each(?))', ids)) {
            const posted = p.stations?.[st.ticket_id.slice(r.length + 1)];
            if (posted) seen.set(st.ticket_id, { station: st.station, path: JSON.parse(st.path), prev: JSON.parse(st.path), bars: posted.bars });
          }
          nonScheduling(this.store, () => this.store.exec('UPDATE board_head SET stations_observation = ? WHERE repository_id = ?', n, r));
          this.settleSpawned(r, p, n, at);
          const confirmed = this.claims.confirm(confirmations, n);
          const judged = this.claims.judge(r, n, seen);
          remember();
          return { ok: true, unchanged: true, ...(p.read_sha === p.sha ? { tickets_upserted: 0, tickets_deleted: 0 } : {}),
            confirmed: confirmed + judged.confirmed, stale_released: judged.stale_released };
        });
      }
    }
    if (p.sha === head) {
      // §4.3 step 4 (R-BTN-11): a refresh — the head's own reading again under a newer number,
      // its stations, paths, next legs and closures replaced; its registry is not applied: the
      // sync builds that body at the commit it fetched, which may be an ancestor of the head, and
      // an older registry would roll a course back. A refresh is a reading like any other: it
      // confirms ends and judges claims made before its number (R-BTN-62, R-BTN-35), not only the
      // post that moved the head.
      // B-183: a source may change a ticket with no commit, so a refresh may now add, close or
      // change any ticket whose `version` differs from the row Baton holds — materialization
      // upserts by `row_hash`, `version` among its inputs. But only a body read at the head it
      // refreshes (`read_sha`, §4.4): a confirm-only re-post from a checkout behind the head
      // (§7.1) is labelled with the head's sha while its tickets were read at the ancestor, and
      // writing them would roll the cache back — so a refresh naming another commit's read, or
      // none (an older CLI's), changes no ticket row, exactly as before B-183. The markdown
      // source's versions are blob ids, so no version changes without a new commit and its
      // refreshes still write no ticket row.
      const readAtHead = normative && p.read_sha === p.sha;
      const refreshed = readAtHead ? await this.rowsFor(repo, p) : null;
      return this.store.transaction(() => {
        // The row hashes were awaited after the number was used, so another run may have posted
        // meanwhile (round 1, finding 2): this reading must still be the newest, over the head it
        // was judged against — the same two re-checks the new-head path performs after its
        // identical await. `accept` would no-op on a newer accepted number, but `rememberSource`
        // would regress the stored declaration and `materialize` would overwrite the newer post's
        // rows with this older reading's and drop every ticket it added.
        if (!this.observations.newest(r, n)) throw new BatonError('stale-observation', `a newer reading than ${n} was accepted while this post was judged; take a new number and retry (R-BTN-62)`);
        if (this.headOf(r) !== head) throw new BatonError('head-moved', `the head moved to ${this.headOf(r) ?? 'unset'} while this post was judged; re-read it and retry`);
        this.observations.accept(r, n);
        if (readAtHead) this.rememberSource(r, p);
        // B-127: the record rides a refresh too (the latest post's word stands); the head has not
        // moved, so no `unsigned-control` event is raised for it again.
        this.applyControl(r, p, at, head);
        let wrote: { upserted: string[]; deleted: number; renumbered: { from: string; to: string; key: string }[]; closingParents: Map<string, string | null> } | null = null;
        if (refreshed) {
          // B-113: a refresh that writes rows may change `depends_on` too (a source whose store
          // moves with no commit, B-183), so its cross-repository edges are judged as a new
          // head's are — resolved, consented, no cycle across boards — before anything is written.
          this.checkQualifiedDependencies(r, liveDeps);
          // Every ticket a refresh writes must name a course in force (R-BTN-48, R-BTN-69, round
          // 1 finding 3) — the same per-ticket check the new-head path runs, without applying the
          // registry the body carries (an older one would roll a course back, above).
          this.requireCoursesInForce(r, refreshed.map(({ row }) => row.course_id));
          wrote = this.materialize(r, refreshed, p.sha, at, new Set((p.closed ?? []).map((c) => c.id)));
          // A live ticket is not closed (stations.ts, R-BTN-12): a refresh that re-adds a
          // withdrawn ticket clears its closure row, as a new head does (round 1, finding 4) —
          // withdraw-and-reopen with no commit is the tracker flow this ticket builds for.
          this.stations.reopened(r, refreshed.map(({ row }) => row.id));
        }
        const seen = normative ? this.refreshStations(r, p, n, at, wrote) : new Map<string, Seen>();
        const confirmed = this.claims.confirm(confirmations, n);
        const judged = this.claims.judge(r, n, seen);
        remember();
        return {
          ok: true, unchanged: true,
          ...(wrote ? { tickets_upserted: wrote.upserted.length, tickets_deleted: wrote.deleted, ...(wrote.renumbered.length ? { renumbered: wrote.renumbered } : {}) } : {}),
          confirmed: confirmed + judged.confirmed, stale_released: judged.stale_released,
        };
      });
    }
    if (!accepted && p.parent_sha !== head) throw new BatonError('head-moved', `the head is ${head ?? 'unset'}; re-read it and retry`);

    // Hash every row before the transaction: the digest is async, the transaction is not.
    const rows = await this.rowsFor(repo, p);
    const changed: { upserted: number; deleted: number; renumbered?: { from: string; to: string; key: string }[]; confirmed?: number; stale_released?: number; courses_refused?: string[]; fleet_ignored?: boolean; dropped?: string[] } = { upserted: 0, deleted: 0 };
    this.store.transaction(() => {
      // The row hashes were awaited after the number was used, so another run may have posted
      // meanwhile: this reading must still be the newest, over the head it was judged against.
      if (!this.observations.newest(r, n)) throw new BatonError('stale-observation', `a newer reading than ${n} was accepted while this post was judged; take a new number and retry (R-BTN-62)`);
      if (this.headOf(r) !== head) throw new BatonError('head-moved', `the head moved to ${this.headOf(r) ?? 'unset'} while this post was judged; re-read it and retry`);
      // B-113 (§4.4): every cross-repository `depends_on` resolves — a live-registered target,
      // a ticket live or closed there, a target at least as visible as this repository or its
      // owners' consent — and no cycle runs through two boards. Before anything is written, so
      // a refused post leaves the head and every row as they were.
      this.checkQualifiedDependencies(r, liveDeps);
      // The course registry first (R-BTN-48, R-BTN-69): every ticket must name a course in
      // force, and a refused file with none to keep refuses the whole post.
      const refused = this.applyRegistry(r, p, rows.map(({ row }) => row.course_id), at);
      if (refused.length) changed.courses_refused = refused;
      const legsBefore = this.queuedLegs(r);
      // The repository's own tickets, keyed by their local ids (R-BTN-47) — upserts by
      // `row_hash`, drops by what the post no longer names, renumberings by `key` (B-183).
      const wrote = this.materialize(r, rows, p.sha, at, new Set((p.closed ?? []).map((c) => c.id)));
      changed.upserted = wrote.upserted.length;
      changed.deleted = wrote.deleted;
      if (wrote.renumbered.length) changed.renumbered = wrote.renumbered;
      const upserted = wrote.upserted;
      // Where each ticket is (R-BTN-70): the normative post's stations, or the interim post's
      // placement at each course's start; and the closures it reports (R-BTN-10).
      const stations = normative
        ? new Map(Object.entries(p.stations ?? {}).map(([id, st]) => [id, stationOf(st)] as [string, PostedStation]))
        : this.stations.interim(r, p.state!.items.map((it) => ({ id: it.id, course: it.course ?? DEFAULT_COURSE, node: it.node })));
      // A live ticket the post does not place is placed nowhere: it is not offered on old data.
      for (const { row } of rows) if (!stations.has(row.id)) this.stations.clear(qualify(r, row.id));
      this.stations.reopened(r, rows.map(({ row }) => row.id));
      // R-BTN-86 (§4.6): the children a `spawned` end reported, judged by this reading — each
      // one it does not post is dropped with discrepancy `spawned-unposted` (R-BTN-85); and the
      // import's pending ticket-scoped rows, applied to the tickets this post creates.
      this.settleSpawned(r, p, n, at);
      this.ownerState.applyPending(r, new Set(rows.map(({ row }) => row.id)), stations, at, true);
      const seen = this.stations.apply(r, p.sha, n, stations, p.closed ?? [], at, wrote.closingParents);
      // R-BTN-116: the questions the post carries for its queued person legs (§4.4), then the
      // sync's attestations (R-BTN-191) — a person leg's answer, read from the ticket's
      // `answer:` — applied as the leg's arrival (R-BTN-39), which may move the ticket before
      // the blocks are re-evaluated below.
      this.questions.posted(r, p.tickets ?? [], new Set(stations.keys()));
      this.questions.attestations(r, p.attestations ?? []);
      // B-129 (R-BTN-85, both values): a post whose ticket frontmatter says `available` while
      // the ticket is past its course's start — the snapshot implying a position Baton has
      // moved past, the false `available`/`prs: []` of the 2026-10-27 release — is a
      // discrepancy. Under B-120 it moves nothing; until then it is at least named.
      this.notePositionDisagreements(r, p, seen, n);
      // R-BTN-75–78: the snapshot's causes — `blocked_by`, `requires`, `needs`, `decisions` and
      // where each ticket is queued — rewrite the changed tickets' blocks in this transaction.
      const dropped = this.applyBlocks(r, stations, upserted, legsBefore, changed.deleted > 0);
      if (dropped.length) changed.dropped = dropped.slice(0, 100);
      // A non-fleet repository's fleet fields are ignored, and its answer says so.
      if (this.reference(r, p)) changed.fleet_ignored = true;
      this.store.exec('INSERT INTO board_snapshots (repository_id, sha, parent_sha, received_at, ticket_count) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repository_id, sha) DO NOTHING', r, p.sha, p.parent_sha, at, ticketCount);
      this.store.exec('INSERT INTO board_head (repository_id, sha) VALUES (?, ?) ON CONFLICT (repository_id) DO UPDATE SET sha = excluded.sha', r, p.sha);
      // B-127: the post's signed-control record stands for the repository (the latest post's
      // word on what counts), and a post that moved the head onto unsigned control inputs —
      // while the repository requires them signed — raises one `unsigned-control` event under
      // Needs you, naming the paths and the commits. A refresh carries the record again and
      // raises nothing new: the head it would name has not moved.
      this.applyControl(r, p, at, head);
      this.rememberSource(r, p);
      // A hold is against one head (R3-1223): when the head moves — an accepted rewrite or a
      // plain fast-forward — every row held against the head it leaves is retired, answered or
      // not. Left in place, an accepted row would accept a NEW rewrite silently whenever the
      // head came back to that sha; an unanswered one is moot (main moved on), and a re-post of
      // its sha is held afresh. So every row left is a hold against the current head. Their
      // history stays in the events.
      this.store.exec('DELETE FROM held_snapshots WHERE repository_id = ? AND head_sha IS ?', r, head);
      this.event(r, 'snapshot-accepted', { sha: p.sha, parent_sha: p.parent_sha, ticket_count: ticketCount, ...changed, ...(accepted ? { held: true } : {}) }, at);
      // B-126 (R-BTN-194): each ticket's `last_written_by`, read from the push deliveries of the
      // range (never the post's own account of what changed). Information only: the post is
      // accepted whatever it finds, and nothing is noticed.
      this.provenance.advance(repo, head, p.sha, at, rows.map(({ row }) => row), new Set(upserted.map((id) => id.slice(r.length + 1))));
      this.observations.accept(r, n);
      const confirmed = this.claims.confirm(confirmations, n);
      // R-BTN-10, R-BTN-35, §2e: git confirms ends, takes tickets away and goes backwards.
      const judged = this.claims.judge(r, n, seen);
      changed.confirmed = confirmed + judged.confirmed;
      changed.stale_released = judged.stale_released;
      remember();
    });
    return { ok: true, ...changed };
  }

  /** B-127 (R-BTN-66 as amended, §7.1): the post's signed-control record — what the sync found
   *  about owner-signed control inputs at this commit — stands for the repository, and a post
   *  that moved the head (`from` is the head it left) onto unsigned control inputs raises one
   *  `unsigned-control` event under Needs you while the repository requires them signed, naming
   *  the paths and the commits. Round 1 (re-firing): only entries the owner has not already
   *  been told raise it — a newly listed path, or the same path under a new unsigned commit —
   *  so one standing unsigned change does not re-notice on every later head move, and opting
   *  the setting on still notices what stands. Round 2: the witness is every notice the
   *  window holds, not the last one — the last event names only what was fresh at its own
   *  head, and once two notices have named different sets (event k naming A, event k+1 naming
   *  B) a last-only dedupe alternated A, B, A, B on every later head move, forever; the union
   *  also carries entries a single event's 50-line display slice left out, so they do not
   *  rotate back in as news. The record is the sync's computation: the paths and signatures
   *  are B-137's to move server-side over the raw commits; the groups a runner loads from are
   *  verified by each runner before it loads them, never only by the sync that posts
   *  them. */
  private applyControl(r: string, p: BoardPayload, at: number, from: string | null): void {
    if (p.control !== undefined) {
      this.store.exec(`INSERT INTO signed_control (repository_id, sha, control_json, updated_at) VALUES (?, ?, ?, ?)
                       ON CONFLICT (repository_id) DO UPDATE SET sha = excluded.sha, control_json = excluded.control_json, updated_at = excluded.updated_at`,
        r, p.sha, JSON.stringify(p.control), at);
    }
    if (from == null || from === p.sha || p.control === undefined) return;
    if (!p.control.unsigned.length) return;
    const required = !!this.sql<{ flag: number }>('SELECT require_signed_control AS flag FROM repositories WHERE id = ?', r)[0]?.flag;
    if (!required) return;
    // Round 2: every prior notice in the view's window (7 days, the same 100 the Needs-you
    // view reads) is the witness — see the comment above. The previous control record is NOT
    // the witness: while the setting was off nothing was raised, and opting in must still
    // notice what stands; an unreadable event says nothing — the event fires.
    const seen = new Set<string>();
    for (const prior of this.sql<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'unsigned-control' AND repository_id = ? AND at > ? ORDER BY at DESC, seq DESC LIMIT 100`, r, at - 7 * 86_400_000)) {
      try {
        for (const u of (JSON.parse(prior.detail_json) as { changes?: { path: string; commits: string[] }[] }).changes ?? []) seen.add(`${u.path}\u0000${u.commits.join(',')}`);
      } catch {
        // Unreadable: nothing from this event is known to have been noticed.
      }
    }
    const fresh = p.control.unsigned.filter((u) => !seen.has(`${u.path}\u0000${u.commits.join(',')}`));
    const changes = fresh.slice(0, 50);
    if (!changes.length) return;
    logEvent(this.store, at, 'unsigned-control', 'sync', { sha: p.sha, parent_sha: from, keys: p.control.keys, changes, ...(fresh.length > changes.length ? { omitted: fresh.length - changes.length } : {}) }, null, null, r);
  }

  /** §14 Needs you, B-127: the unsigned control changes of the last 7 days, newest first, of
   *  repositories that require their control inputs signed — by `at`, then `seq`, the order
   *  `events_by_kind_at` reads in (B-235), so the window reads only its rows. */
  unsignedControlView(now: number) {
    return this.sql<{ repository_id: string; at: number; detail_json: string }>(
      `SELECT repository_id, at, detail_json FROM events WHERE kind = 'unsigned-control' AND at > ? ORDER BY at DESC, seq DESC LIMIT 100`, now - 7 * 86_400_000)
      .map((row) => {
        let detail: Record<string, unknown> = {};
        try {
          detail = JSON.parse(row.detail_json) as Record<string, unknown>;
        } catch {
          detail = {};
        }
        return { repository_id: row.repository_id, at: row.at, ...detail };
      });
  }

  /** B-127: the signed-control record a claim answer carries while its repository requires
   *  signed control — the setting and the owner keys from Baton itself, the groups from the
   *  record stored on the claim by its own transaction (round 2's pairing: the answer and a
   *  lost-response replay serve the claim's own record, never a newer post's). `required` and
   *  `keys` are never the post's word; the groups' commits are the post's, and each runner
   *  verifies them against `keys` before loading, so a post that lied about a signature
   *  changes what a runner refuses, not what it runs. With the setting off, `{}`: nothing is
   *  gated, and the ticket's brief mark rides its row as ever. A group missing (`read` null or
   *  absent) is the fail-closed case — no signed version — and the runner treats it so. */
  private async claimControl(ticket: string, claimId: number): Promise<{ control?: unknown }> {
    if (!ticket.includes(':')) return {};
    const repo = repositoryOf(ticket);
    if (!this.sql<{ flag: number }>('SELECT require_signed_control AS flag FROM repositories WHERE id = ?', repo)[0]?.flag) return {};
    const register = await this.admin.signingKeys(repo);
    const keys = register.map((k) => k.public_key);
    // The claim's own record, stored at the claim (0041): immutable from the answer's side.
    const stored = this.sql<{ control_json: string | null }>('SELECT control_json FROM claims WHERE id = ?', claimId)[0]?.control_json ?? null;
    let groups: Record<string, { read: string | null; key: string | null; unsigned: string[] }> = {};
    let recordKeys: string[] | null = null;
    try {
      const parsed = stored ? (JSON.parse(stored) as { keys?: unknown; groups: Record<string, { read: string | null; key: string | null; unsigned: string[] }> }) : null;
      groups = parsed?.groups ?? {};
      recordKeys = Array.isArray(parsed?.keys) ? parsed.keys.filter((k): k is string => typeof k === 'string') : null;
    } catch {
      groups = {};
    }
    // Round 4 (the register moved): the record was computed under the keys it names, and the
    // runner verifies under today's register. When the two differ — an owner key registered or
    // removed between the post and the claim — a disagreement is the record's age, not a lie
    // the claim should pay for: `register_moved` tells the runner to release such a claim as
    // a stale board (unpenalised) instead of `cannot-finish:spec`. It never changes what loads:
    // every check still runs against today's register, and the next post re-computes under it.
    const now = new Set(register.map((k) => k.fingerprint));
    const moved = recordKeys != null && (recordKeys.length !== now.size || recordKeys.some((k) => !now.has(k)));
    return { control: { required: true, keys, ...(moved ? { register_moved: true } : {}), ...groups } };
  }

  /** B-129 (R-BTN-85, "every disagreement with git is logged", both values): the accepted post's
   *  tickets whose frontmatter says `available` while the post itself places them past their
   *  course's start — the false `status: available` a hurried release wrote over an open PR
   *  (B-91, 2026-10-27). Core reads no course field (R-BTN-50) and stores no PR list (R-BTN-33),
   *  so it cannot tell that release from one that kept its PRs: both fire. Logged once per
   *  station (the sync posts every 15 minutes), judged against the ticket's last
   *  `position-disagrees` row, moving nothing (B-120's rule; until it lands, named). The path's
   *  length is the witness: a ticket past its start has one. */
  private notePositionDisagreements(r: string, p: BoardPayload, seen: Map<string, Seen>, n: number): void {
    if (!p.tickets) return;
    const statusOf = new Map(p.tickets.map((t) => [qualify(r, t.id), t.display?.status ?? null]));
    for (const [id, s] of seen) {
      if (s.path.length === 0 || statusOf.get(id) !== 'available') continue;
      const last = this.sql<{ detail_json: string }>(
        `SELECT detail_json FROM events WHERE ticket_id = ? AND kind = 'discrepancy' AND json_extract(detail_json, '$.sub') = 'position-disagrees' ORDER BY seq DESC LIMIT 1`, id)[0];
      let before: { baton?: { station?: unknown } } = {};
      try {
        before = last ? JSON.parse(last.detail_json) : {};
      } catch {
        before = {};
      }
      if (before.baton?.station === s.station) continue;
      this.history.discrepancy(id, 'position-disagrees', { station: s.station, path: s.path }, { status: 'available' }, n);
    }
  }

  /** A post's tickets as hashed rows (§4, R-BTN-33): hashed before any transaction, the digest
   *  being async. `version` and `key` are inputs of the hash, so a ticket whose version changed
   *  rewrites its row (B-183). The interim post's items (docs until R3-1233) become rows the
   *  same way; only a refresh skips materialization for them (§4.3: the interim post carries no
   *  versions, and its refreshes change no ticket). */
  private async rowsFor(repo: Repository, p: BoardPayload): Promise<{ row: TicketRow; hash: string }[]> {
    const rankOf = new Map((p.ready ?? []).map((id, i) => [id, i]));
    const posted = p.tickets !== undefined
      ? p.tickets.map(rowForTicket)
      : p.state!.items.map((it) => rowFor(it, rankOf));
    return await Promise.all(posted.map(async (base) => {
      // R-BTN-66: tiers arrive by name and are matched as positions in this repository's ladder.
      const row = { ...base, tier_position: tierPosition(repo.tiers, base.tier ?? null) };
      return { row, hash: await rowHash(row) };
    }));
  }

  /** Write a post's ticket rows (§4.3, R-BTN-11, R-BTN-35): the repository's own tickets, keyed
   *  by their local ids (R-BTN-47) — rows whose `row_hash` changed are upserted, tickets the post
   *  no longer names leave the cache (their claims and events stay), and — B-183 (R-BTN-147) — a
   *  dropped ticket replaced by a **new** id at the same `key` is `renumbered`: the new id takes
   *  the old one's hold and backoff, and an event says the move. Returns what it wrote, beside
   *  the parents of the tickets it dropped that the post reports closing (`stations.apply` keeps
   *  the relation past the close, R-BTN-86). */
  private materialize(r: string, rows: { row: TicketRow; hash: string }[], sha: string, at: number, closing: ReadonlySet<string> = new Set()): { upserted: string[]; deleted: number; renumbered: { from: string; to: string; key: string }[]; closingParents: Map<string, string | null> } {
    const upserted: string[] = [];
    const renumbered: { from: string; to: string; key: string }[] = [];
    const closingParents = new Map<string, string | null>();
    const have = new Map(this.sql<{ local_id: string; row_hash: string; key: string | null; path: string; parent: string | null }>(
      'SELECT local_id, row_hash, key, path, parent FROM tickets WHERE repository_id = ?', r).map((x) => [x.local_id, x]));
    // R-BTN-86 (§4.6): each posted parent becomes a stored qualified id — or none, logged
    // `parent-invalid` — judged here, inside the transaction, against the board it holds: this
    // post's parents beside the stored ones (the closed tickets count as known, leaves of the
    // walk). Never a refused post.
    const existingParents = new Map([...have].map(([id, x]) => [id, x.parent]));
    // R-BTN-86: the closed parents count as known leaves of the walk — read only when a posted
    // ticket names a parent at all, so a board of parentless tickets (the ordinary kind) pays
    // nothing for the relation (B-241's statement budget).
    const anyParent = rows.some(({ row }) => row.parent != null) || [...existingParents.values()].some((p) => p != null);
    const closedKnown = anyParent
      ? new Set(this.sql<{ local_id: string }>('SELECT substr(ticket_id, length(?) + 2) AS local_id FROM closed_tickets WHERE ticket_id >= ? || \':\' AND ticket_id < ? || \';\'', r, r, r).map((x) => x.local_id))
      : new Set<string>();
    const parents = resolveParents(r, rows.map(({ row }) => ({ id: row.id, parent: row.parent ?? null })), existingParents, closedKnown);
    for (const bad of parents.invalid.slice(0, 100)) {
      logEvent(this.store, at, 'parent-invalid', 'sync', { ticket: qualify(r, bad.ticket), parent: bad.parent, reason: bad.reason }, qualify(r, bad.ticket), null, r);
    }
    if (parents.invalid.length > 100) {
      logEvent(this.store, at, 'parent-invalid', 'sync', { omitted: parents.invalid.length - 100 }, null, null, r);
    }
    // A new ticket's key → its id, for the renumbering read of the dropped rows. Only ids the
    // board did not already hold (review round 1): the post ADDS a ticket at the key of one it
    // drops (R-BTN-147) — an existing ticket that moves onto a dropped key keeps its own hold
    // and backoff, it is not "renumbered onto".
    const held = new Set(have.keys());
    const byKey = new Map(rows.filter(({ row }) => !held.has(row.id)).map(({ row }) => [row.key ?? row.path ?? row.id, row.id]));
    const wasHeld = new Set(have.keys());
    let newTickets = 0;
    for (const { row, hash } of rows) {
      const before = have.get(row.id);
      have.delete(row.id);
      const parent = parents.parentOf.get(row.id)?.qualified ?? null;
      if (before?.row_hash === hash) {
        // The row is unchanged as posted; its stored parent may still move — the same raw value
        // resolves differently against a board that changed around it (an orphan's parent
        // posted, a cycle closed by other tickets).
        if (before?.parent !== parent) this.store.exec('UPDATE tickets SET parent = ? WHERE id = ?', parent, qualify(r, row.id));
        continue;
      }
      const id = qualify(r, row.id);
      this.store.exec(
        `INSERT INTO tickets (id, repository_id, local_id, path, title, project, status, node, queue, tags, tier, requires_clause, operator_only,
           depends_on, blocked_by, repos, ord, rank, snapshot_sha, row_hash, since, holder, course_id, tier_position, expedite, display, version, key, brief, parent, course_fields_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET path = excluded.path, title = excluded.title, project = excluded.project,
           status = excluded.status, node = excluded.node, queue = excluded.queue, tags = excluded.tags,
           tier = excluded.tier, requires_clause = excluded.requires_clause, operator_only = excluded.operator_only,
           depends_on = excluded.depends_on, blocked_by = excluded.blocked_by, repos = excluded.repos,
           ord = excluded.ord, rank = excluded.rank, snapshot_sha = excluded.snapshot_sha, row_hash = excluded.row_hash,
           since = excluded.since, holder = excluded.holder, course_id = excluded.course_id, tier_position = excluded.tier_position,
           expedite = excluded.expedite, display = excluded.display, version = excluded.version, key = excluded.key, brief = excluded.brief,
           parent = excluded.parent, course_fields_json = excluded.course_fields_json`,
        id, r, row.id, row.path, row.title, row.project, row.status, row.node, row.queue, row.tags, row.tier,
        row.requires_clause, row.operator_only, row.depends_on, row.blocked_by, row.repos, row.ord, row.rank, sha, hash, row.since, row.holder, row.course_id,
        row.tier_position, row.expedite, row.display, row.version, row.key, row.brief ?? null, parent, row.course_fields ?? null);
      this.store.exec('DELETE FROM ticket_requires WHERE ticket_id = ?', id);
      for (const name of row.requires) this.store.exec('INSERT INTO ticket_requires (ticket_id, name) VALUES (?, ?)', id, name);
      upserted.push(id);
      if (!wasHeld.has(row.id)) newTickets++;
      // R-BTN-86: a child first appearing on the board — its `spawned` history row on the parent
      // it names, when the board knows that parent (an orphan's is held for the parent that may
      // still land; a history row for an unknown ticket is nobody's record).
      const resolved = parents.parentOf.get(row.id);
      if (!wasHeld.has(row.id) && resolved?.qualified != null && resolved.known) {
        this.history.record(resolved.qualified, { kind: 'spawned', detail: { child: id } });
      }
    }
    let deleted = 0;
    // Tickets no longer live leave the cache (R-BTN-35); their claims and events stay.
    for (const [gone, had] of have) {
      const id = qualify(r, gone);
      if (closing.has(gone)) closingParents.set(gone, had.parent ?? null);
      this.stations.clear(id);
      this.blocks.forget(id);
      this.store.exec('DELETE FROM ticket_requires WHERE ticket_id = ?', id);
      this.store.exec('DELETE FROM tickets WHERE id = ?', id);
      this.queues.touch(id);
      deleted++;
      // B-183 (R-BTN-147): the post drops one id and adds another at the same `key` — the source
      // renumbered its ticket. The new id takes the old one's hold and backoff (`ticket_overrides`),
      // and the move is logged as an event `renumbered`.
      const key = had.key ?? had.path;
      const to = key != null ? byKey.get(key) : undefined;
      if (key != null && to != null && to !== gone) {
        this.store.exec(
          `INSERT INTO ticket_overrides (ticket_id, expedite, hold, hold_reason, retry_after, set_by, set_at, runs_json)
           SELECT ?, expedite, hold, hold_reason, retry_after, set_by, set_at, runs_json FROM ticket_overrides WHERE ticket_id = ?
           ON CONFLICT (ticket_id) DO UPDATE SET hold = excluded.hold, hold_reason = excluded.hold_reason,
             retry_after = excluded.retry_after, runs_json = excluded.runs_json`,
          qualify(r, to), id);
        this.store.exec('DELETE FROM ticket_overrides WHERE ticket_id = ?', id);
        this.event(r, 'renumbered', { from: gone, to, key }, at);
        renumbered.push({ from: gone, to, key });
      }
    }
    // R3-1258: the maintained tickets count (R-BTN-87's figure) moves with what this post wrote
    // and dropped — never COUNTed, a growing table being what B-236 refuses to scan.
    if (newTickets || deleted) adjustCounts(this.store, { tickets: newTickets - deleted });
    return { upserted, deleted, renumbered, closingParents };
  }

  /** B-183 (§4.4, R-BTN-184): a `custom` source that reads only as it is now has no ticket file
   *  to approve, so its post to a repository whose policy's floors include the `tickets-approved`
   *  guarantee is refused, naming the guarantee. */
  private refuseCurrentUnderApprovalFloor(repo: Repository, p: BoardPayload): void {
    if (p.source?.kind !== 'custom' || p.source.versions !== 'current') return;
    const floored = this.policies.floors(repo.id).filter((f) => f.guarantees.includes('tickets-approved'));
    if (!floored.length) return;
    throw new BatonError('invalid-params',
      `this repository's policy floors include the tickets-approved guarantee, which is defined over a ticket file's approval (R-BTN-184) — a custom ticket source with versions: "current" cannot post it (B-183)`);
  }

  /** B-183: the last accepted post's ticket-source declaration, kept on the head for the claim
   *  answer (§4.5: the runner re-verifies by the source's own way of reading). A post that
   *  declares none keeps what stood — an older CLI's post undeclares nothing. */
  private rememberSource(r: string, p: BoardPayload): void {
    if (p.course_data !== undefined) this.store.exec('UPDATE board_head SET course_data = ? WHERE repository_id = ?', JSON.stringify(p.course_data), r);
    if (!p.source) return;
    this.store.exec('UPDATE board_head SET source_kind = ?, source_versions = ? WHERE repository_id = ?', p.source.kind, p.source.versions ?? null, r);
  }

  /** B-183 (§4.3): each live ticket's last accepted version, keyed by local id, for the
   *  observation's answer — Baton's own record, returned to the posting credential only, as
   *  `positions` is. A ticket posted with no version holds `''`. */
  ticketVersions(r: string): Record<string, string> {
    return Object.fromEntries(this.sql<{ local_id: string; version: string }>('SELECT local_id, version FROM tickets WHERE repository_id = ?', r).map((t) => [t.local_id, t.version]));
  }

  /** R-BTN-86 / R-BTN-85 (R3-1258): judge the children a `spawned` end reported, in the
   *  transaction that accepts the reading — the first snapshot observed after the end (its
   *  number strictly greater, R-BTN-62's rule). Each reported child the post does not name,
   *  live or closed, is dropped with discrepancy `spawned-unposted` on the parent; the posted
   *  ones stay recorded as the run's (a call's completion range, R-BTN-165 — B-62 reads it).
   *  A refresh judges as a new head does: it is a reading too. */
  private settleSpawned(r: string, p: BoardPayload, n: number, at: number): void {
    const due = this.sql<{ ticket_id: string; claim_id: number; children_json: string }>(
      'SELECT ticket_id, claim_id, children_json FROM spawned_children WHERE repository_id = ? AND observation < ?', r, n);
    if (!due.length) return;
    const posted = new Set<string>([
      ...((p.tickets ?? []).map((t) => t.id)),
      ...((p.state?.items ?? []).map((t) => t.id)),
      ...(p.closed ?? []).map((c) => c.id),
    ]);
    for (const row of due) {
      const reported = JSON.parse(row.children_json) as string[];
      const kept = reported.filter((id) => posted.has(id));
      if (kept.length < reported.length) {
        this.history.discrepancy(row.ticket_id, 'spawned-unposted', { children: reported, source: 'the spawned end' }, { posted: kept }, n, row.claim_id);
      }
      if (kept.length) {
        this.store.exec('UPDATE spawned_children SET children_json = ? WHERE repository_id = ? AND ticket_id = ? AND claim_id = ?',
          JSON.stringify(kept), r, row.ticket_id, row.claim_id);
      } else {
        this.store.exec('DELETE FROM spawned_children WHERE repository_id = ? AND ticket_id = ? AND claim_id = ?', r, row.ticket_id, row.claim_id);
      }
    }
    void at;
  }

  /** A refresh's stations (§4.3, R-BTN-62): the head's tickets as the refresh materialized them,
   *  where each is replaced. `wrote` is the refresh's own materialization (B-183) — null on a
   *  held history's refresh, which changes no ticket. */
  private refreshStations(r: string, p: BoardPayload, n: number, at: number, wrote: { upserted: string[]; deleted: number } | null, held = false): Map<string, Seen> {
    const live = new Set(this.sql<{ local_id: string }>('SELECT local_id FROM tickets WHERE repository_id = ?', r).map((t) => t.local_id));
    const stations = new Map(Object.entries(p.stations ?? {}).filter(([id]) => live.has(id)).map(([id, st]) => [id, stationOf(st)] as [string, PostedStation]));
    // As on a new head: a live ticket the refresh does not place is placed nowhere, never offered
    // on an old station (round 1, 1-A-0, 1-B-0).
    const legsBefore = this.queuedLegs(r);
    for (const id of live) if (!stations.has(id)) this.stations.clear(qualify(r, id));
    // R-BTN-88: a refresh can supply the first placement, but only a materializing read
    // decides which tickets are absent. A held history cannot consume a pending position.
    if (!held) this.ownerState.applyPending(r, live, stations, at, wrote != null);
    // A held history's closures stand even for tickets the current head still has: the holder's
    // archive may be in the rewritten history alone, and its done end must not wait the hold's
    // 24 hours (R-BTN-62; round 2, 2-A-0). A plain refresh's own closures are applied as they
    // arrive (B-183): validation already refuses a post closing a ticket it also posts, and its
    // materialization dropped what it no longer names.
    const seen = this.stations.apply(r, p.sha, n, stations, (p.closed ?? []).filter((c) => held || !live.has(c.id)), at);
    // R-BTN-86: a refresh judges a `spawned` end's children as a new head does — it is a
    // reading too, numbered above the end's.
    this.settleSpawned(r, p, n, at);
    // R-BTN-116: a refresh carries the tickets' questions and the run's attestations like a new
    // head (§4.4) — each is idempotent, so a re-post of the same question or answer moves nothing.
    this.questions.posted(r, (p.tickets ?? []).filter((t) => live.has(t.id)), new Set(stations.keys()));
    this.questions.attestations(r, p.attestations ?? []);
    // A refresh's stations carry `needs` and `decisions` too (R-BTN-76, R-BTN-78); a refresh that
    // materialized (B-183) recounts for what its rows moved, as a new head does.
    this.applyBlocks(r, stations, wrote?.upserted ?? [], legsBefore, !!wrote && wrote.deleted > 0);
    return seen;
  }

  /** Each of the repository's tickets' queued leg (R-BTN-83), by qualified id. */
  private queuedLegs(r: string): Map<string, string | null> {
    return new Map(this.sql<{ id: string; next_leg: string | null }>(
      'SELECT t.id, s.next_leg FROM tickets t LEFT JOIN ticket_stations s ON s.ticket_id = t.id WHERE t.repository_id = ?', r).map((x) => [x.id, x.next_leg]));
  }

  /** A snapshot's share of the blocks (R-BTN-75): its `needs` and `decisions` stored, the fleet
   *  counts brought to what is needed now, and the rows of every ticket whose causes changed —
   *  its row, its needs or decisions, or its queued leg — rewritten. Returns what it reports: a
   *  need failing the resource rule or naming an unregistered resource, a decision with a reserved
   *  id or a url outside the ticket's repositories (R-BTN-76, R-BTN-78). */
  private applyBlocks(r: string, stations: Map<string, PostedStation>, upserted: string[], legsBefore: Map<string, string | null>, removed = false): string[] {
    const live = this.sql<{ local_id: string }>('SELECT local_id FROM tickets WHERE repository_id = ?', r).map((x) => x.local_id);
    const { changed, dropped } = this.blocks.posted(r, stations, live);
    // A closed `baton:stalled`, the recount and the post's own rows are evaluated once, after all
    // three (R-BTN-75; B-49).
    this.blocks.batch(() => {
      // R-BTN-78: a `baton:stalled` whose queued leg the snapshot posts other than waiting closes.
      this.blocks.settleStalled(r);
      // The counts follow what is needed: a post that changed a ticket — its row (where `requires`
      // lives), its needs or its decisions — or dropped one recounts; a post that changed nothing
      // does not (R-BTN-75, R-BTN-76). Coarser than "what is needed changed", by design: a row's
      // hash does not say which field moved, and a recount that finds no crossing writes no row.
      if (upserted.length || changed.length || removed) this.blocks.recount();
      const moved = [...this.queuedLegs(r)].filter(([id, leg]) => legsBefore.get(id) !== leg).map(([id]) => id);
      this.blocks.write([...upserted, ...changed, ...moved]);
    });
    return dropped;
  }

  /** Every course a post's tickets name must be in force (R-BTN-48, R-BTN-69) — checked wherever
   *  rows are materialized: on a new head (inside `applyRegistry`, after the registry applies)
   *  and on a refresh that writes rows (round 1, finding 3), so no course-less ticket can sit in
   *  the cache that no course resolves. */
  private requireCoursesInForce(r: string, ticketCourses: string[]): void {
    for (const c of new Set(ticketCourses)) {
      if (!this.courses.get(r, c)) throw new BatonError('invalid-params', `a ticket's course ${c} is not in ${r}'s registry`);
    }
  }

  /** B-113 (§4.4): a post's cross-repository `depends_on`, judged inside its transaction — every
   *  qualified id resolves against its target's board (a live-registered repository, a ticket
   *  live or closed there), the target is at least as visible as the posting repository or its
   *  owners consented, and no dependency cycle runs through two boards (dependencies.ts holds
   *  both checks, pure over the store this transaction holds). */
  private checkQualifiedDependencies(r: string, live: readonly { id: string; depends_on: readonly string[] }[]): void {
    const sql = <T>(q: string, ...a: unknown[]): T[] => this.sql<T>(q, ...a);
    checkCrossRepository(sql, r, live);
    checkCrossBoardCycle(sql, r, live);
  }

  /** The registry of a post (R-BTN-48, R-BTN-69), inside its transaction: applied whole, then
   *  every course the post's tickets name must be in force — a refused file with none to keep,
   *  or a course the registry dropped while a ticket still names it, refuses the post. */
  private applyRegistry(r: string, p: BoardPayload, ticketCourses: string[], at: number): string[] {
    const refused = p.registry ? this.courses.apply(r, p.registry, p.sha, at) : [];
    this.stations.reset();
    this.requireCoursesInForce(r, ticketCourses);
    // R-BTN-64: a course file accepted with renames carries its active claims over.
    for (const e of p.registry ?? []) {
      if (refused.includes(e.id)) continue;
      this.claims.renameActive(r, e.id);
      // R-BTN-83: a ticket queued for a leg the accepted file no longer has there waits on course-changed.
      this.stations.recheckCourse(r, e.id);
    }
    // R-BTN-79: every course in force — accepted now or kept over a refused file — has its renamed
    // legs' tickets moved and each leg's bound judged against the row's, so a bound never waits on
    // a file being fixed (round 2, 2-r2-0); a course the registry dropped takes its queues and
    // their notices with it (round 1, 1-A-3).
    const inForce = this.courses.all().filter((c) => c.repository_id === r).map((c) => c.id);
    for (const c of inForce) this.queues.coursed(r, c);
    this.queues.retain(r, inForce);
    return refused;
  }

  /** The reference data the sync posts with every snapshot (§7.3, §7.4): the reviewer catalog
   *  and matrix. Each table is a copy of a docs file, never edited here, so it is rewritten
   *  whole. The model tables' blocks — `providers`, `prices` — are gone (B-142): what they
   *  carried is a reading or a course rule (§6.3, R-BTN-76), and a sync that still posts them
   *  is accepted with the fields ignored.
   *  Returns whether the payload carried fleet data this repository may not write. */
  private reference(repo: string, p: BoardPayload): boolean {
    const exec = (q: string, ...a: unknown[]) => this.store.exec(q, ...a);
    // §6.8, R-BTN-66: a repository's transcript repositories are its owners' setting, never read
    // from a board post (R3-1240); a sync that still sends them is not refused for it.
    // The rest is the instance's: only the fleet repository writes it (interim, R3-1231 2b).
    const carries = p.matrix != null || p.reviewers != null;
    if (this.registry.fleetRepository() !== repo) return carries;
    const catalog = p.reviewers ?? p.matrix?.agents;
    if (catalog && p.matrix) {
      exec('DELETE FROM reviewer_agents');
      for (const [name, a] of Object.entries(catalog)) {
        exec('INSERT INTO reviewer_agents (name, reviews_on, family, bills, models) VALUES (?, ?, ?, ?, ?)',
          name, a.reviews_on, familyOf(a.reviews_on, p.matrix) ?? 'unknown', JSON.stringify(a.bills), a.models ? JSON.stringify(a.models) : null);
      }
    }
    // Rule 8 (R-BTN-27) reads the whole matrix (rows, seats, costs) and the posted catalog.
    if (p.matrix) exec(`INSERT INTO baton_settings (key, value) VALUES ('reviewer_matrix', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify(p.matrix));
    if (p.reviewers) exec(`INSERT INTO baton_settings (key, value) VALUES ('reviewer_catalog', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify(p.reviewers));
    return false;
  }

  private event(repo: string, kind: string, detail: unknown, at: number) {
    this.store.exec('INSERT INTO events (at, kind, actor, detail_json, repository_id) VALUES (?, ?, ?, ?, ?)', at, kind, 'sync', JSON.stringify(detail), repo);
  }

  // ── the dashboard's state (§14: Ready and Providers in rollout step 1) ─────────────────

  /** One registered repository as the state lists it (B-90: `baton board` reads the same):
   *  its own head and its own mode (R-BTN-47, R-BTN-28), and its courses with their queues. */
  private uiRepo(repo: Repository) {
    const sha = this.headOf(repo.id);
    const head = sha ? this.sql('SELECT sha, parent_sha, received_at, ticket_count FROM board_snapshots WHERE repository_id = ? AND sha = ?', repo.id, sha)[0] ?? null : null;
    const courses = this.courses.all().filter((c) => c.repository_id === repo.id).map(({ id, version, min_runner_version, skill }) => ({ id, version, min_runner_version, skill,
        // R-BTN-79: the course's intake and each of its queues, for the Courses view.
        intake: this.queues.intake(repo.id, id), queues: this.queues.legs(repo.id, id).map(({ leg, depth, max_queue }) => ({ leg, depth, max_queue })) }));
    return { id: repo.id, github: repo.github, forge: repo.forge, web_base: repo.web_base, default_branch: repo.default_branch, weight: repo.weight, head, mode: this.runners.mode(repo.id), courses };
  }

  /** `GET /v1/admin/repositories` (B-90, R-BTN-179): the registry as the dashboard's state lists
   *  it — one section of `stateView`'s answer, built by the same `uiRepo` it maps over. */
  adminView() {
    return { repositories: this.registry.all().map((repo) => this.uiRepo(repo)) };
  }

  /** `GET /v1/owner/{repository}/grants` (R-BTN-146, B-90): the repository's owner keys, the
   *  grants on it, and its owners' settings — the dashboard's state's own reads, for its owners. */
  grantsView(repo: string) {
    // The same four sections `stateView().limits` serves, over one repository: owners, grants
    // (their max_tier as its name in the repository's ladder), settings and the bars in force.
    const limits = this.admin.view(this.now());
    return {
      repository: repo,
      owners: limits.owners.filter((o) => o.repository_id === repo),
      // R-BTN-58: a key granted here may be granted elsewhere too, and its holder decides once
      // for all of them — so each row also names the other repositories that key holds
      // (`other_repositories`, revoked grants excluded).
      grants: limits.grants.filter((g) => g.repository_id === repo).map((g) => ({
        credential_id: g.credential_id, hostname: g.hostname, label: g.label, repository_id: g.repository_id,
        capabilities: g.capabilities, max_tier: g.max_tier, max_claims: g.max_claims, granted_by: g.granted_by, granted_at: g.granted_at,
        other_repositories: limits.grants.filter((o) => o.credential_id === g.credential_id && o.repository_id !== repo).map((o) => o.repository_id).sort(),
      })),
      settings: limits.settings.find((s) => s.repository_id === repo) ?? null,
      // R-BTN-67: the bars in force and scheduled, always carrying their repository's id.
      bars: limits.bars.filter((b) => (b as { repository_id: string }).repository_id === repo),
      server_time: this.now(),
    };
  }

  /** `GET /v1/repositories/{repository}/board` (B-90): the dashboard's view of one repository —
   *  the repository as the state lists it, its `ready` tickets and the per-tier order,
   *  derived by the same `readyRows` it derives them with, for one repository — and one field the
   *  dashboard does not have. `granted_capabilities` is the key's grant's capabilities — the
   *  heartbeat answer's field — so a granted runner knows its grant from the read alone; null
   *  for a key no grant binds and for an owner's or an administrator's key. `holders` (B-129) is
   *  the repository's live claims with each holder and its lease's end — the lock a session
   *  claiming through git reads with the same request (R-BTN-179's one-answer rule). */
  boardView(repo: string, granted: string[] | null = null) {
    const now = this.now();
    const repository = this.uiRepo(this.registry.get(repo)!);
    const ready = this.readyRows([repository], repo);
    return {
      repository,
      ready,
      ready_by_tier: this.readyByTier(ready, [repo]),
      holders: this.claims.holdersOf(repo),
      granted_capabilities: granted,
      server_time: now,
    };
  }

  /** Ready: a ticket whose queued leg its sync posts ready (R-BTN-70), the interim post's
   *  included — it places each ready item at its course's start (round 2, 2-A-4). For one
   *  repository when `repository_id` is given (B-90's board), every one otherwise. */
  private readyRows(repositories: ReturnType<BatonCore['uiRepo']>[], repository_id?: string) {
    const byId = new Map(repositories.map((r) => [r.id, r]));
    const items = this.sql<Record<string, SqlValue>>(
      `SELECT t.id, t.repository_id, t.local_id, t.path, t.title, t.project, t.status, t.node, t.queue, t.tags, t.tier, t.requires_clause, t.operator_only, t.ord, t.rank,
              t.expedite, t.snapshot_sha, t.last_written_by, t.brief, s.station, s.next_leg, s.to_end
       FROM tickets t JOIN repositories p ON p.id = t.repository_id
       JOIN ticket_stations s ON s.ticket_id = t.id
       JOIN ticket_next_legs a ON a.ticket_id = t.id AND a.leg = s.next_leg AND a.state = 'ready'
       WHERE p.retired_at IS NULL${repository_id ? ' AND t.repository_id = ?' : ''} ORDER BY p.weight DESC, t.expedite DESC, s.to_end, t.rank IS NULL, t.rank, t.repository_id, t.id`,
      ...(repository_id ? [repository_id] : []));
    const requires = new Map<string, string[]>();
    for (const r of this.sql<{ ticket_id: string; name: string }>('SELECT ticket_id, name FROM ticket_requires WHERE ticket_id IN (SELECT value FROM json_each(?)) ORDER BY name', JSON.stringify(items.map((t) => t.id)))) {
      requires.set(r.ticket_id, [...(requires.get(r.ticket_id) ?? []), r.name]);
    }
    return items.map((r) => ({
      id: r.id,
      repository_id: r.repository_id,
      local_id: r.local_id,
      title: r.title,
      url: ((w) => fileUrl(w.forge, w.web_base, w.default_branch, r.path as string))(byId.get(r.repository_id as string)!),
      project: r.project,
      tier: r.tier,
      // The commit that last changed the ticket's row — a re-tier shows beside it (S-BTN-39).
      changed_in: r.snapshot_sha,
      // B-126 (R-BTN-194): the pusher of the commit that last changed the ticket's file, and
      // B-127's brief mark (signed, and by whom), so a privileged session can see whose words
      // steer it before it reads them.
      ...((w) => (w ? { last_written_by: w } : {}))(writtenBy(r.last_written_by)),
      ...((b) => (b ? { brief: b } : {}))(briefMark(r.brief)),
      queue: r.queue,
      node: r.node,
      rank: r.rank,
      station: r.station,
      leg: r.next_leg,
      rank_reason: r.node ? (r.node === 'ready-expedite' ? 'expedite lane' : `${r.queue} queue · order ${r.ord ?? '—'}`)
        : `${r.expedite ? 'expedite lane · ' : ''}${r.next_leg} from ${r.station} · rank ${r.rank ?? '—'}`,
      requires_clause: r.requires_clause,
      requires: requires.get(r.id as string) ?? [],
      operator_only: r.operator_only === 1,
    }));
  }

  /** Per tier ceiling, the order a runner under it would be offered (§13 step 1's exit). Each
   *  tier name of any ladder, lowest first; a ticket appears under the names of its own
   *  repository's ladder that it fits (R-BTN-66). Derived from the `ready` rows given, so the
   *  board's tier order is its own repository's and never a filtering of another's (B-90). */
  private readyByTier(ready: { id: unknown; repository_id: unknown; tier: unknown }[], only?: string[]) {
    const ladders = new Map(this.registry.all().filter((x) => !only || only.includes(x.id)).map((x) => [x.id, x.tiers]));
    const names = [...new Set([...ladders.values()].flat())];
    return Object.fromEntries(names.map((t) => [t, ready.filter((r) => {
      const ladder = ladders.get(r.repository_id as string) ?? [...TIERS];
      return ladder.includes(t) && fitsTier((r.tier as string | null) ?? null, t, ladder);
    }).map((r) => r.id)]));
  }

  /** `GET /v1/admin/state` (R-BTN-57, R-BTN-179; B-118, B-216's Decision 4a): the state in one
   *  request for a terminal, an administrator's key's alone — built by the functions the entity
   *  reads use (`readyRows`, `claims.running`, `runners.runnersView`, `history.view`, the
   *  modules' `needsYou`), so the two cannot drift (S-BTN-170). The dashboard session's own
   *  `GET` of this answer is retired (B-203): a session reads the entity reads. */
  stateView() {
    const now = this.now();
    // R3-1258 (R-BTN-87): the envelope's figures read ONCE for the whole answer — Needs you's
    // `capacity` listing and the Capacity view share them (B-240's statement budget).
    const figures = this.capacityFigures();
    // Each registered repository: its own head and its own mode (R-BTN-47, R-BTN-28).
    const repositories = this.adminView().repositories;
    const ready = this.readyRows(repositories);
    const byTier = this.readyByTier(ready);
    // The Runners view, read once for both the rows it serves and Needs you's stale clients
    // (R-BTN-197, B-254) — one read, B-240's statement budget kept.
    const runners = this.runners.runnersView(now);

    const held = this.sql(
      `SELECT repository_id, sha, parent_sha, head_sha, ticket_count, received_at, auto_accept_at FROM held_snapshots
       WHERE accepted_at IS NULL ORDER BY received_at`);
    // B-142: `providers` and `suspensions` served here no more — the model tables they read are
    // gone; an unavailable provider is a reading (§6.3, R-BTN-76) and a peak preference a rule
    // in the course (§6.10), never a dashboard row.
    return {
      server_time: now, repositories, ready, ready_by_tier: byTier, held, runners,
      running: this.claims.running(now), timeline: this.claims.timeline(now),
      // R-BTN-66: owners, grants, owner bars and settings — read-only; the CLI changes them.
      limits: this.admin.view(now),
      // B-4 (§11.4's tenant settings, R-BTN-113): the instance settings — `session_hosts` the
      // client's link gate checks against (§12.3).
      instance: this.instance.view(),
      // R-BTN-69: a refused course file, the previous one staying in force.
      needs_you: { ...this.claims.needsYou(now), ...this.blocks.needsYou(now), ...this.notices.needsYou(now), ...this.stations.needsYou(), adoptions: this.cutover.adoptions(), courses_refused: this.courses.refusals(), keys: this.keysNotice(),
        // R-BTN-87 (R3-1258): the figures over 80% of the envelope — `baton.capacity` through
        // today's path, until B-57 converts it to a condition.
        ...this.capacity.needsYou(figures),
        // R-BTN-197 (B-254): each live runner whose own version statement is below the
        // recommended client, with its version — update it at your own pace; nothing self-updates.
        stale_clients: this.runners.staleClients(runners, this.instance.recommendedClient()),
        // B-134: the open scope findings — a leg reported outside its ticket's scope, a runner
        // push no open claim covers — until an owner resolves each.
        scope: this.scope.needsYou(),
        // B-133: the person legs' questions with each option's computed action (R-BTN-116).
        questions: this.questions.needsYou(),
        // B-234 (R-BTN-163, R-BTN-195): the open conditions, an `interact` with the session
        // link Baton set — a person asked into the leg's session.
        conditions: this.conditions.needsYou(),
        // B-127: the unsigned control changes a post moved the head onto while signed control is required.
        unsigned_control: this.unsignedControlView(now) },
      // R-BTN-75, R-BTN-76: each blocked ticket with its blocks, and the instances' states.
      blocked: this.blocks.view(),
      // R-BTN-85: the disagreements with git of the last 7 days, by kind.
      discrepancies: this.history.view(now),
      resources: this.resources.view(now),
      // R-BTN-87 (§2.3, R3-1258): the Capacity view — every figure against the envelope, and
      // the day's usage against the plan's limits (R-BTN-2).
      capacity: this.capacity.view(figures),
    };
  }
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BatonError('invalid-params', 'the body is not JSON');
  }
}
