// baton.ts — the host-neutral composition root (R-BTN-55): wire the core modules to the
// host's ports and sequence startup, requests and the alarm. The front verifies what it can;
// signed requests finish verification in the core before their route acts.
import { MIGRATIONS } from '../migrations';
import { versionedStore, type VersionedStore } from './stateVersion';
import { servedClientVersions, withClientVersions } from './http';
import type { BoardPayload } from './board';
import { Stations } from './stations';
import { Questions } from './questions';
import { Conditions } from './conditions';
import { Admin } from './admin';
import { RunnerApi } from './runnerApi';
import { Claims } from './claims';
import { forgeScope } from './forgeScope';
import { Cutover } from './cutover';
import { Mirror } from './mirror';
import { hiddenSessionLink } from './links';
import { Courses } from './courses';
import { Observations } from './observations';
import { Sequences } from './sequences';
import { Webhooks } from './webhook';
import { Stats } from './stats';
import { Blocks } from './blocks';
import { Resources } from './resources';
import { Notices } from './notices';
import { Queues } from './queues';
import { History } from './history';
import { InstanceSettings } from './instanceSettings';
import { Provenance } from './provenance';
import { Capacity, RequestRing } from './capacity';
import { OwnerState } from './ownerState';
import { Registry, repositoryOf, type Repository } from './registry';
import { Policies } from './policy';
import { Scope } from './scope';
import { systemRandom } from './db';
import { Deprecated } from './deprecated';
import { Retention } from './retention';
import type { Ports, Row, Workflow } from './ports';
import { board, rowsFor, sendDispatch } from './sync';
import { adminView, boardView, grantsView, keysNotice, stateView, unsignedControlView } from './views';
import { dispatchRoute } from './routes';
import { humanBreakGlass } from './routes/principal';

const ALARM_EVERY_MS = 60_000; // §3: one alarm, every 60 seconds

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
    this.dispatcher = (wf) => sendDispatch(this, ports.dispatch, wf);
    this.deprecated = new Deprecated(this.store);
    this.outside = ports.gate ? (work) => ports.gate!.outside(work) : (work) => work();
    const store = this.store;
    this.registry = new Registry({ store, now: () => this.now(), ensurePolicy: (repository, forge) => this.policies.ensure(repository, forge) });
    // §12.8 (B-145): the policy store, before everything that reads a knob — the claims' floor
    // rule, the heartbeat's reports and pins, the owner routes' approver checks.
    this.policies = new Policies({ store, now: () => this.now(), releaseForFloor: (repository) => this.claims.releaseForFloor(repository) });
    // R3-1258: the capacity envelope (R-BTN-87) and owner state (R-BTN-88), each one module
    // with the store and the clock alone.
    this.capacity = new Capacity({ store, now: () => this.now(), config: ports.config });
    this.ownerState = new OwnerState({ store, now: () => this.now(), origin: ports.config.BATON_ORIGIN,
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
    this.retention = new Retention({ store, now: () => this.now(), sealed: () => this.ownerState.sealedAt() != null, outside: this.outside });
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
      closeMissingNext: (ticket, at) => this.conditions.closeMissingNext(ticket, at),
      contractWaits: (repo, at, ticket) => this.conditions.contractWaits(repo, at, ticket),
      linkBases: (ticket) => this.blocks.linkBases(ticket), answersFrom: (repo) => this.policies.current(repo)?.policy.inputs.answers ?? 'git',
      dispatch: (kind, ticketId) => want({ repository: repositoryOf(ticketId), kind }) });
    // B-234 (R-BTN-160, R-BTN-195): the raised conditions — a course's own vocabulary decides a
    // disposition (never the runner's word), a `suspend` url keeps only under R-BTN-92's link
    // bases (as a question's), and the Needs-you and list reads a delivery runner polls.
    this.conditions = new Conditions({ store, now: () => this.now(), graph: (repo, course) => this.stations.graph(repo, course), history: this.history,
      linkBases: (ticket) => this.blocks.linkBases(ticket) });
    this.claims = new Claims({ store, now: () => this.now(), random: (n) => this.random(n), stations: this.stations, admin: this.admin, blocks: this.blocks, history: this.history, resourceReadings: this.resources,
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
    const before = keysNotice(this);
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
  flushDispatch() {
    // A repository's unblocked trigger is its own automation, not the mirror's: sent whatever its
    // mode. So is a sync Baton's own webhook path sends (B-89): a merge, and the alarm after one.
    const own = (wf: Workflow) => wf.kind === 'unblocked' || wf.own === true;
    const due = [...this.pendingDispatch.values()].filter((wf) => own(wf) || this.cutover.cutoverAt(wf.repository) != null);
    this.pendingDispatch.clear();
    if (!due.length) return;
    this.ports.dispatch.defer(Promise.all(due.map((wf) => this.dispatcher(wf).catch(() => false))));
  }

  /** Dispatch these repositories' syncs after the response; a failure waits for the webhook
   *  path's own backstop or the schedule (R-BTN-73: never retried more than once). B-89: a
   *  dispatch from this path — a merge, the alarm after one, another repository's delivery — is
   *  sent whatever the repository's mode (`own`). A failure is not silently dropped: the stamp
   *  `receive`/`dueSync` wrote stands, and the alarm's `nextDue()` sends it again at
   *  `last_dispatch_at + SYNC_STALE_MS` (§7.1, round 4 finding 3). */
  syncNow(repositories: string[]) {
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
  async armBy(at: number | null) {
    if (at == null) return;
    const current = await this.ports.scheduler.get();
    if (current == null || at < current) await this.ports.scheduler.set(at);
  }

  /** B-249 (S-BTN-2): a healthy request or reaper turn establishes that Baton could serve.
   *  Stamp at most once a period. Record any recovery and its stamp in the same transaction;
   *  only cache the stamp after commit so ordinary conditional polls need no extra read. */
  private serviceStamp = -Infinity;
  private recordServing(): number {
    const now = this.now();
    if (now - this.serviceStamp < ALARM_EVERY_MS) return this.serviceStamp;
    const last = this.sql<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'last_served_at'`)[0];
    if (last && now - Number(last.value) < ALARM_EVERY_MS) return Number(last.value);
    // A successful request inside the sampling period may not have moved the stamp.
    if (last) this.claims.recoverLeases(now, now - Number(last.value) - ALARM_EVERY_MS);
    this.store.liveness(() => {
      this.store.exec(`INSERT INTO baton_settings (key, value) VALUES ('last_served_at', ?)
                       ON CONFLICT (key) DO UPDATE SET value = excluded.value`, String(now));
    });
    return now;
  }

  /** §3: the one alarm, every 60 seconds — earlier when a webhook's trailing dispatch or the
   *  webhook path's own backstop is due. */
  // @model alarmLive sha256:9738e53567a4
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
      const reaper = this.store.transaction(() => {
        const stamp = this.recordServing();
        return { stamp, unreaped: this.claims.alarm() };
      });
      this.serviceStamp = reaper.stamp;
      unreaped = reaper.unreaped;
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
    // R-BTN-149: archive old events before pruning. Storage I/O never spans a SQL transaction.
    await this.retention.prune(this.ports.archiveEvents);
    // B-229: a reap that could not be written fails the tick only now, after its work: the
    // failure reaches the host's log naming each claim, and the next tick tries it again.
    if (unreaped.length) throw new Error(`the alarm could not reap ${unreaped.length} claim(s): ${unreaped.join('; ')}`);
  }

  /** R-BTN-77: each repository's unblocked dispatch due now, queued to send after the commit. */
  private takeUnblocked() {
    for (const d of this.blocks.takeDue()) this.pendingDispatch.set(`${d.repository}:unblocked`, { repository: d.repository, kind: 'unblocked', tickets: d.tickets });
  }

  sql<T = Row>(query: string, ...params: unknown[]): T[] {
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
      const res = await dispatchRoute(this, req, url);
      // An error answer means its transaction rolled back: nothing changed to mirror.
      if (res.ok) {
        // R-BTN-77: the unblocked dispatches this request made due, coalesced per window.
        this.serviceStamp = this.store.transaction(() => {
          const stamp = this.recordServing();
          this.takeUnblocked();
          return stamp;
        });
        this.flushDispatch();
        await this.armBy(this.blocks.nextDue());
        await this.armBy(this.resources.nextLapse());
      } else {
        this.pendingDispatch.clear();
        if (res.status === 304 && this.now() - this.serviceStamp >= ALARM_EVERY_MS) {
          this.serviceStamp = this.store.transaction(() => this.recordServing());
        }
      }
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

  get config() { return this.ports.config; }
  adminKeys() { return this.ports.adminKeys.list(); }
  humanBreakGlass() { return humanBreakGlass(this.ports); }

  private rowsFor = rowsFor;

  // @model syncPost sha256:9d500d65a2bf
  async board(repo: Repository, p: BoardPayload) {
    return board(this, repo, p, this.rowsFor);
  }

  unsignedControlView(now: number) { return unsignedControlView(this, now); }

  adminView() { return adminView(this); }
  grantsView(repo: string) { return grantsView(this, repo); }
  boardView(repo: string, granted: string[] | null = null, sessionLink = hiddenSessionLink) { return boardView(this, repo, granted, sessionLink); }
  stateView() { return stateView(this); }
}
