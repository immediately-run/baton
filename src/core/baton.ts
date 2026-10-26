// baton.ts — Baton's core (BATON_SPEC §3, §3a R-BTN-55): every table, every write, the routing
// of the API behind the front (front.ts), and the alarm. It names no platform: a host hands it
// the ports (ports.ts) — the Durable Object on Cloudflare (src/cloudflare/), a Node process
// locally (src/local/) — and runs one request at a time between awaits, as §3 requires. Each
// request's writes are one transaction, so the compare-and-set below needs no lock. Requests
// reach it only through the front, which has verified the principal — all but a signed
// request's key, signature, clock and nonce, which only the core can check (verifySigned).
import { MIGRATIONS } from '../migrations';
import { BatonError, errorResponse, json } from './http';
import { checkPayload, DEFAULT_COURSE, inPeak, nextPeakChange, rowFor, rowForTicket, rowHash, stationOf, type BoardPayload, type PostedStation } from './board';
import { Stations, type Seen } from './stations';
import { Admin, SESSION_COOKIE, SESSION_MS } from './admin';
import { priceFor } from '../shared/sessionUsage.mjs';
import { familyOf } from '../shared/baton.mjs';
import { fitsTier, TIERS } from '../shared/vocabulary.mjs';
import { WorkerApi } from './workerApi';
import { parseSshKey, verifyApiKey, verifyRequest, withBody, type SyncCredential } from './auth';
import { Claims } from './claims';
import { Cutover } from './cutover';
import { Mirror } from './mirror';
import { checkConfirmations, checkRepositoryId, GIT_BRANCH, GIT_REPO } from './validate';
import { Courses } from './courses';
import { Observations } from './observations';
import { Webhooks, type Delivery } from './webhook';
import { fileUrl } from './links';
import { Stats, STATS_WINDOW_MS } from './stats';
import { Blocks } from './blocks';
import { Resources } from './resources';
import { Notices, type Courier } from './notices';
import { Queues } from './queues';
import { History, HISTORY_PAGE_MAX } from './history';
import { checkBlockedOn, checkNoticeClaim } from './validate';
import { Registry, TICKET_ID, qualify, repositoryOf, tierPosition, type Repository, type SyncClaims } from './registry';
import type { Ports, Row, SqlValue, Store, Workflow } from './ports';

const HELD_AUTO_ACCEPT_MS = 24 * 3_600_000; // §7.1: a held history is accepted after 24 h (R3-1212)
const ALARM_EVERY_MS = 60_000; // §3: one alarm, every 60 seconds

export class BatonCore {
  /** The clock (R-BTN-32). Tests replace it; nothing else here reads the time. */
  now: () => number;

  readonly workers: WorkerApi;
  readonly claims: Claims;
  readonly cutover: Cutover;
  readonly mirror: Mirror;
  readonly registry: Registry;
  readonly courses: Courses;
  readonly observations: Observations;
  readonly webhooks: Webhooks;
  readonly stations: Stations;
  readonly admin: Admin;
  readonly stats: Stats;
  readonly blocks: Blocks;
  readonly resources: Resources;
  readonly notices: Notices;
  readonly queues: Queues;
  readonly history: History;
  readonly store: Store;
  /** §12: workflows to dispatch once the current request or alarm has committed, one per
   *  repository and kind. */
  private pendingDispatch = new Map<string, Workflow>();
  /** The dispatch call; tests replace it (as they replace `now`) to see what would be sent. */
  dispatcher: (workflow: Workflow) => Promise<unknown>;
  /** §3: a signature check (R3-1239) or a hook call (R3-1236) is awaited through this, so
   *  another request may run meanwhile on both hosts alike (R-BTN-55). */
  readonly outside: <T>(work: () => Promise<T>) => Promise<T>;

  constructor(private readonly ports: Ports) {
    this.now = ports.clock ?? (() => Date.now());
    this.store = ports.store;
    this.dispatcher = (wf) => this.sendDispatch(wf);
    this.outside = ports.gate ? (work) => ports.gate!.outside(work) : (work) => work();
    const store = ports.store;
    this.registry = new Registry({ store, now: () => this.now() });
    this.courses = new Courses({ store, requiredBars: (repo) => this.admin.requiredBars(repo) });
    this.observations = new Observations({ store, now: () => this.now() });
    this.webhooks = new Webhooks({ store, now: () => this.now() });
    const want = (wf: Workflow) => this.pendingDispatch.set(`${wf.repository}:${wf.kind}`, wf);
    // R-BTN-75: the blocks are written with their causes; `fits` is the claim gates' (R-BTN-77).
    // R-BTN-80, R-BTN-81: a decision's notices are queued and closed with it, and its history row written.
    this.notices = new Notices({ store, now: () => this.now() });
    this.history = new History({ store, now: () => this.now() });
    const decisionRows = (ticket: string, ids: string[], kind: 'decision-opened' | 'decision-answered') => {
      for (const id of ids) this.history.record(ticket, { kind, detail: { decision: id } });
    };
    this.blocks = new Blocks({ store, now: () => this.now(), fits: (worker, ticket) => this.claims.fits(worker, ticket), history: this.history,
      decisions: {
        opened: (ticket, ids) => { this.notices.opened(ticket, ids); decisionRows(ticket, ids, 'decision-opened'); },
        closed: (ticket, ids) => { this.notices.closed(ticket, ids); decisionRows(ticket, ids, 'decision-answered'); },
      },
      queued: (ticket) => this.queues.touch(ticket) });
    // R-BTN-79: each leg's queue, counted where membership changes; a leg over its bound warns.
    this.queues = new Queues({ store, now: () => this.now(), held: (ticket) => this.blocks.isHeld(ticket),
      graph: (repo, course) => this.stations.graph(repo, course), notices: this.notices });
    this.resources = new Resources({ store, now: () => this.now(), blocks: this.blocks });
    this.admin = new Admin({ store, now: () => this.now(), registry: this.registry, adminKeys: () => ports.adminKeys.list(), origin: ports.config.BATON_ORIGIN,
      dispatchSync: (repository) => want({ repository, kind: 'sync' }), fleetChanged: () => this.blocks.recount(), notices: this.notices });
    this.stations = new Stations({ store, now: () => this.now(), requiredBars: (repo) => this.admin.requiredBars(repo), history: this.history });
    this.claims = new Claims({ store, now: () => this.now(), stations: this.stations, admin: this.admin, blocks: this.blocks, history: this.history,
      schema: (repo, id) => this.courses.schema(repo, id), intake: (repo, course) => this.queues.intake(repo, course),
      dispatch: (kind, ticketId) => want({ repository: repositoryOf(ticketId), kind }) });
    this.cutover = new Cutover({ store, now: () => this.now(), held: (ticket) => this.blocks.held(ticket, true) });
    this.stats = new Stats(store, this.queues);
    this.mirror = new Mirror({ store, now: () => this.now(), held: (ticket) => this.blocks.held(ticket, true) });
    this.workers = new WorkerApi({ store, config: ports.config, now: () => this.now(), fenced: (w, inc, id) => this.claims.fenced(w, inc, id),
      // R-BTN-76: what a heartbeat declares it uses; the fleet's counts move with the worker.
      uses: (w, repos, names) => this.resources.applyUses(w, repos, names), fleetChanged: () => this.blocks.recount(),
      // R-BTN-103: what it delivers as a worker courier.
      couriers: (w, granted, entries) => this.notices.declare(w, granted, entries),
      held: (ticket) => this.blocks.held(ticket, true),
      claimView: (id) => this.claims.holderView(id),
      // A granted key's repositories are its grants' (R-BTN-58); an ungranted one's, every one it may reach.
      bars: (now, cred) => this.admin.bars(this.workers.credential(cred).granted
        ? this.sql<{ repository_id: string }>('SELECT repository_id FROM worker_grants WHERE credential_id = ? AND revoked_at IS NULL', cred).map((r) => r.repository_id)
        : null, now).map(({ id: _id, release_holders: _r, ...b }) => ({ repository: b.repository_id, course: b.course, tag: b.tag, legs: b.legs, applies: b.applies, starts_at: b.starts_at, ends_at: b.ends_at, reason: b.reason })) });
  }

  /** Before the first request (§3): every migration applied — the core refuses to serve until
   *  they are — and the one alarm armed. The host runs this before it lets a request in. */
  async start(): Promise<void> {
    this.migrate();
    this.store.transaction(() => this.registry.seed(this.ports.config));
    await this.registry.seedSyncKeys(this.ports.config, this.ports.adminKeys.list());
    await this.seedKeys();
    if ((await this.ports.scheduler.get()) == null) await this.ports.scheduler.set(this.now() + ALARM_EVERY_MS);
    // A trailing webhook dispatch owed from before a restart keeps its time (round 1, 1-A-4);
    // so do a trailing unblocked dispatch and the next reading to lapse (R-BTN-76, R-BTN-77).
    await this.armBy(this.webhooks.nextTrailing());
    await this.armBy(this.blocks.nextDue());
    await this.armBy(this.resources.nextLapse());
  }

  /** The worker keys from BATON_KEYS (R3-1239). A list that cannot be seeded changes nothing
   *  and stops nothing — the keys in force stay, and the sync, the dashboard and every other
   *  principal serve on — but goes to Needs you, as does a revoked key the list names again. */
  private async seedKeys(): Promise<void> {
    const before = this.keysNotice();
    // What the list in force last reported stands until another list seeds.
    let notice: { refused?: string; revoked_listed?: string[] } | null = before?.revoked_listed ? { revoked_listed: before.revoked_listed } : null;
    try {
      const r = await this.workers.seedKeys();
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
   *  caller's response. */
  private flushDispatch() {
    // A repository's unblocked trigger is its own automation, not the mirror's: sent whatever its mode.
    const due = [...this.pendingDispatch.values()].filter((wf) => wf.kind === 'unblocked' || this.cutover.cutoverAt(wf.repository) != null);
    this.pendingDispatch.clear();
    if (!due.length) return;
    this.ports.dispatch.defer(Promise.all(due.map((wf) => this.dispatcher(wf).catch(() => false))));
  }

  /** §10.3: a repository's sync or mirror workflow, on its default branch. A repository with no
   *  mirror has nothing to dispatch for it. */
  private sendDispatch(wf: Workflow): Promise<unknown> {
    const repo = this.registry.get(wf.repository);
    if (wf.kind === 'unblocked') {
      // R-BTN-77: one input, `tickets`, JSON — every id and ref in it passed its rule (§10.4). Only
      // the GitHub App's dispatch is built here; GitLab's and Gitea's adapters are R3-1263's.
      const trigger = this.sql<{ t: string | null }>('SELECT unblocked_trigger AS t FROM repositories WHERE id = ?', wf.repository)[0]?.t;
      const t = trigger ? (JSON.parse(trigger) as { kind: string; workflow?: string }) : null;
      if (!repo || t?.kind !== 'github-app' || !t.workflow) return Promise.resolve(false);
      return this.ports.dispatch.send({ github: repo.github, workflow: t.workflow.slice(t.workflow.lastIndexOf('/') + 1), ref: repo.default_branch, inputs: { tickets: JSON.stringify(wf.tickets ?? []) } });
    }
    const path = wf.kind === 'sync' ? repo?.sync_workflow : repo?.mirror_workflow;
    if (!repo || !path) return Promise.resolve(false);
    return this.ports.dispatch.send({ github: repo.github, workflow: path.slice(path.lastIndexOf('/') + 1), ref: repo.default_branch });
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
      const { req: signed, cred } = await this.verifySigned(req, (fp) => this.registry.syncKey(fp)?.public_key ?? this.workers.publicKey(fp) ?? admins.get(fp) ?? null);
      // An administrator key is never a sync's, even one added to BATON_ADMIN_KEYS after it was
      // registered as a sync key (round 3, 3-A-2).
      if (admins.has(cred)) throw new BatonError('forbidden', 'an administrator key holds no other role (R-BTN-57)');
      const key = this.registry.syncKey(cred);
      // A worker, probe, courier or administrator key is never a sync's (R-BTN-57, R-BTN-93).
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
      this.syncNow(out.now);
      if (out.trailing.length) await this.armBy(this.webhooks.nextTrailing());
    }
    return out;
  }

  /** Dispatch these repositories' syncs after the response; a failure waits for the next
   *  trigger or the schedule (R-BTN-73: never retried more than once). */
  private syncNow(repositories: string[]) {
    if (repositories.length) this.ports.dispatch.defer(Promise.all(repositories.map((repository) => this.dispatcher({ repository, kind: 'sync' }).catch(() => false))));
  }

  /** The alarm fires by `at` (§3: one alarm; set earlier, never later). */
  private async armBy(at: number | null) {
    if (at == null) return;
    const current = await this.ports.scheduler.get();
    if (current == null || at < current) await this.ports.scheduler.set(at);
  }

  /** §3: the one alarm, every 60 seconds — earlier when a webhook's trailing dispatch is due. */
  // @model alarmLive sha256:ca9f6ccd8aa0
  async alarm(): Promise<void> {
    // Re-armed first, so one failing tick never ends the cycle.
    await this.ports.scheduler.set(this.now() + ALARM_EVERY_MS);
    this.syncNow(this.store.transaction(() => this.webhooks.dueTrailing()));
    await this.armBy(this.webhooks.nextTrailing());
    // Claims first, so a worker reaped this tick has its messages expired in the same tick.
    let lapse: number | null = null;
    try {
      this.store.transaction(() => {
        this.claims.alarm();
        this.workers.alarm();
        // R-BTN-76: readings lapse; R-BTN-75: liveness moves the counts; R-BTN-77: a pending
        // `unblocked` message dies with its worker's liveness, and a window's trailing dispatch goes.
        // Time moves liveness: recount when, and only when, the live set changed (R-BTN-75); a
        // lapsed reading's recount has already taken the live set, so a tick runs one recount.
        // R-BTN-78: a queued leg posted waiting for 72 hours is put to the owner. The recount's rows
        // and the stall's decision row are evaluated once, after both, before the dispatch reads
        // what unblocked (B-49).
        lapse = this.blocks.batch(() => {
          const next = this.resources.alarm();
          if (this.blocks.liveChanged()) this.blocks.recount();
          this.blocks.raiseStalled(this.now());
          return next;
        });
        this.blocks.expireMessages();
        this.takeUnblocked();
        // R-BTN-80: lapsed leases and due reminders queue again; old closed notices go.
        this.notices.alarm();
        // R-BTN-81: the history of tickets closed 90 days ago goes.
        this.history.purge();
      });
    } catch (e) {
      this.pendingDispatch.clear(); // rolled back: nothing to tell the mirror
      throw e;
    }
    this.flushDispatch();
    await this.armBy(lapse);
    await this.armBy(this.blocks.nextDue());
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
        this.store.script(m.sql);
        this.store.exec('INSERT INTO _baton_migrations (id, applied_at) VALUES (?, ?)', m.id, this.now());
      });
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    this.pendingDispatch.clear();
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
      return res;
    } catch (e) {
      this.pendingDispatch.clear(); // the transaction rolled back: nothing changed to mirror
      throw e;
    }
  }

  private async route(req: Request, url: URL): Promise<Response> {
    try {
      if (url.pathname.startsWith('/v1/sync/')) {
        // R-BTN-15: the board's routes take only the repository's sync workflow, the feed's only
        // its mirror workflow; each touches that repository alone.
        if (req.method === 'GET' && url.pathname === '/v1/sync/head') return json(this.head((await this.verifySync(req, 'sync')).repo.id));
        // R-BTN-62: the next number of the repository's counter, before the sync reads anything.
        if (req.method === 'POST' && url.pathname === '/v1/sync/observation') {
          const repo = (await this.verifySync(req, 'sync')).repo.id;
          // R-BTN-67: with the owner bars in force or scheduled for the repository, each with its course.
          return json({ ...this.observations.observe(repo), bars: this.admin.bars([repo], this.now(), true).map(({ repository_id: _r, ...b }) => b) });
        }
        if (req.method === 'POST' && url.pathname === '/v1/sync/board') {
          const { repo, req: signed } = await this.verifySync(req, 'sync');
          const body = await readJson(signed);
          let p: BoardPayload;
          try {
            p = checkPayload(body);
          } catch (e) {
            // A refused post uses its number too (R-BTN-62), malformed or not, so the sync's
            // next run is not held off as busy for ten minutes.
            const n = (body as { observation?: unknown } | null)?.observation;
            if (Number.isSafeInteger(n)) this.observations.release(repo.id, n as number);
            throw e;
          }
          return json(await this.board(repo, p));
        }
        if (req.method === 'GET' && url.pathname === '/v1/sync/events') {
          const { repo } = await this.verifySync(req, 'mirror');
          const after = Number(url.searchParams.get('after') ?? 0);
          const limit = Number(url.searchParams.get('limit') ?? 200);
          if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit)) throw new BatonError('invalid-params', 'after and limit must be integers');
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
      if (url.pathname.startsWith('/v1/admin/') || url.pathname.startsWith('/v1/owner/')) return await this.adminRoute(req, url);
      if (req.method === 'POST' && url.pathname === '/v1/login') {
        // R-BTN-57, R-BTN-16: the one-time link's token for the session cookie — `__Host-`,
        // host-only, Secure, HttpOnly, SameSite=Strict, at most 12 hours.
        const value = await this.admin.login(await readJson(req));
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
      }
      if (req.method === 'GET' && url.pathname === '/v1/ui/state') return json(this.uiState());
      const read = await this.blocksRoute(req, url);
      if (read) return read;
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
      const routed = await this.workerRoute(req, url, owner);
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
  private keysNotice(): { refused?: string; revoked_listed?: string[] } | null {
    const raw = this.sql<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'keys_notice'`)[0]?.value;
    return raw ? JSON.parse(raw) : null;
  }

  /** A signed request (R3-1239), verified whole by the one verifier: the key its keyid names
   *  among the keys in force, the SSHSIG in the `baton-request` namespace, `created` within 5
   *  minutes of this clock — then its nonce, unseen for that key. The crypto runs outside the
   *  turn (§3); the nonce is checked and written after it. Returns the request with its body
   *  put back and the credential: the key's fingerprint. */
  private async verifySigned(req: Request, lookup: (fp: string) => string | null = (fp) => this.workers.publicKey(fp)): Promise<{ req: Request; cred: string }> {
    const now = this.now();
    const v = await this.outside(() => verifyRequest(req, lookup, { origin: this.ports.config.BATON_ORIGIN, now }));
    // Another request ran meanwhile: the key may have been revoked since it was read.
    if (!lookup(v.keyid)) throw new BatonError('unauthenticated', 'the key is not registered or is revoked');
    this.workers.acceptNonce(v.keyid, v.nonce, now);
    return { req: withBody(req, v.body), cred: v.keyid };
  }

  /** R-BTN-13 or R-BTN-159: a signed request's key, or an API key's fingerprint — whichever the
   *  front passed — checked against `lookup`. */
  private async authenticated(req: Request, lookup?: (fp: string) => string | null): Promise<{ req: Request; cred: string }> {
    const apiKey = req.headers.get('X-Baton-Api-Key');
    if (apiKey == null) return this.verifySigned(req, lookup);
    return { req, cred: await verifyApiKey(apiKey, lookup ?? ((fp) => this.workers.publicKey(fp))) };
  }

  /** The worker and owner routes of R3-1211. The front passes the principal in
   *  `X-Baton-Credential` (a bearer token's credential, verified), `X-Baton-Signed` (a signed
   *  request's keyid, pre-checked; verifySigned finishes it here) or `X-Baton-Owner` (the Access
   *  email); it strips all of them from every incoming request first. */
  private async workerRoute(req: Request, url: URL, owner: string | null): Promise<Response | null> {
    const p = url.pathname;
    const m = req.method;
    let cred = req.headers.get('X-Baton-Credential');
    const secret = req.headers.get('X-Worker-Secret');
    if (req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key')) {
      // R-BTN-13 as amended: the front checked the request's shape, @authority and digest; the
      // key, the signature and the clock are checked here, and the nonce in this turn. An API
      // key (R-BTN-159) is checked against the public line its grant registered.
      ({ req, cred } = await this.authenticated(req));
      // One role per key (R-BTN-57): a key in BATON_ADMIN_KEYS is never a worker's, even one
      // granted before it was listed.
      if ((await this.admin.adminFingerprints()).has(cred)) throw new BatonError('forbidden', 'an administrator key is never a worker key (R-BTN-57)');
    }
    const tx = <T>(f: () => T): T => this.store.transaction(f);
    const stats = /^\/v1\/repositories\/([^/]+)\/stats$/.exec(p);
    if (m === 'GET' && stats) {
      // §2d, §11: a course's record, for any key granted on the repository (R-BTN-58).
      // Aggregates and ids only (G-BTN-64).
      if (!cred) throw new BatonError('unauthenticated', 'no worker principal');
      let segment: string;
      try {
        segment = decodeURIComponent(stats[1]);
      } catch {
        throw new BatonError('invalid-params', 'a malformed path segment');
      }
      const repo = checkRepositoryId(segment);
      if (!this.registry.get(repo)) throw new BatonError('not-found', `no repository ${repo}`);
      // A grant on the repository, whatever the key (round 1, 1-A-0): a bearer or seed key has no
      // grant, so it reads no repository's stats — the item's "Do not".
      this.workers.credential(cred);
      if (!this.sql('SELECT 1 FROM worker_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', cred, repo).length) {
        throw new BatonError('forbidden', `the key is not granted on ${repo} (R-BTN-58)`);
      }
      const raw = url.searchParams.get('since');
      const now = this.now();
      const since = raw == null ? now - STATS_WINDOW_MS : Date.parse(raw);
      if (!Number.isFinite(since) || since > now) throw new BatonError('invalid-params', 'since: must be an ISO time not in the future');
      return json({ ok: true, ...this.stats.of(repo, since, now) });
    }
    if (p.startsWith('/v1/runner/')) {
      if (!cred) throw new BatonError('unauthenticated', 'no worker principal');
      if (m === 'POST' && p === '/v1/runner/heartbeat') {
        const body = await readJson(req);
        // The hashing is async; the writes happen in one transaction after it (§3: atomic).
        return json(await this.workers.heartbeat(cred, secret, body));
      }
      if (m === 'GET' && p === '/v1/runner/mode') {
        await this.workers.authWorker(cred, secret);
        // §11: `?repository=` — each repository cuts over on its own (R-BTN-28).
        const repo = checkRepositoryId(url.searchParams.get('repository'));
        if (!this.registry.get(repo)) throw new BatonError('invalid-params', 'repository: must be a registered repository id');
        return json(this.workers.mode(repo));
      }
      if (m === 'GET' && p === '/v1/runner/branch-holder') {
        // §6.3: a push to an item branch asks who holds the tickets it maps to; machine key alone,
        // or with a secret so the caller's own claim is not "another".
        // A pre-push hook has git's spellings: refs/heads/<branch> and owner/name.git.
        const gitRepo = (url.searchParams.get('repo') ?? '').replace(/\.git$/, '');
        const branch = (url.searchParams.get('branch') ?? '').replace(/^refs\/heads\//, '');
        if (!GIT_REPO.test(gitRepo)) throw new BatonError('invalid-params', 'repo: must be owner/name');
        if (!GIT_BRANCH.test(branch)) throw new BatonError('invalid-params', 'branch: must be a branch name');
        const caller = secret ? await this.workers.authWorker(cred, secret) : null;
        return json(this.claims.branchHolder(caller, gitRepo, branch));
      }
      const holder = /^\/v1\/runner\/tickets\/([^/]+)\/holder$/.exec(p);
      if (m === 'GET' && holder) {
        // R-BTN-7: callable with the token alone (the witness has no sidecar); with a secret, the
        // caller's own claim is not "another".
        const item = this.ticketParam(holder[1]);
        const caller = secret ? await this.workers.authWorker(cred, secret) : null;
        return json(this.claims.holder(caller, item));
      }
      const workerId = await this.workers.authWorker(cred, secret);
      if (m === 'POST' && p === '/v1/runner/claim') {
        const body = await readJson(req);
        return json(tx(() => this.claims.claim(workerId, body)));
      }
      if (m === 'GET' && p === '/v1/runner/next') return json(this.claims.next(workerId));
      if (m === 'GET' && p === '/v1/runner/recommendations') {
        // §11: `?limit=`, default 10, applied after the merge (R-BTN-61).
        const raw = url.searchParams.get('limit');
        const limit = raw == null ? 10 : Number(raw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BatonError('invalid-params', 'limit: must be an integer from 1 to 50');
        return json(this.claims.recommendations(workerId, limit));
      }
      const advance = /^\/v1\/runner\/claims\/(\d+)\/advance$/.exec(p);
      if (m === 'POST' && advance) {
        const body = await readJson(req);
        return json(tx(() => this.claims.advance(workerId, Number(advance[1]), body)));
      }
      if (m === 'POST' && p === '/v1/runner/adopt') {
        const body = await readJson(req);
        return json(tx(() => this.cutover.adopt(workerId, body)));
      }
      const end = /^\/v1\/runner\/claims\/(\d+)\/end$/.exec(p);
      if (m === 'POST' && end) {
        const body = await readJson(req);
        return json(tx(() => this.claims.end(workerId, Number(end[1]), body)));
      }
      if (m === 'POST' && p === '/v1/runner/readings') {
        // R-BTN-76, R-BTN-101: what a leg met — on its own worker instances and on any account
        // instance listing a repository its key works on.
        const body = await readJson(req);
        return json(this.resources.post({ kind: 'worker', workerId, credential: cred }, body, this.grantedRepos(cred)));
      }
      if (m === 'POST' && p === '/v1/runner/activities') {
        const body = await readJson(req);
        return json(this.workers.activities(workerId, body));
      }
      const ack = /^\/v1\/runner\/messages\/(\d+)\/ack$/.exec(p);
      if (m === 'POST' && ack) {
        // An absent body is an acknowledgement with no reply; a malformed one is refused.
        const body = req.headers.get('Content-Length') === '0' || !req.body ? null : await readJson(req);
        return json(tx(() => this.workers.ack(workerId, Number(ack[1]), body)));
      }
      if (m === 'POST' && p === '/v1/runner/shadow-report') {
        const body = await readJson(req);
        return json(tx(() => this.workers.shadowReport(workerId, body)));
      }
      return null;
    }
    if (p.startsWith('/v1/ui/') && m === 'POST') {
      if (!owner) throw new BatonError('unauthenticated', 'no owner principal');
      if (p === '/v1/ui/messages') {
        const body = await readJson(req);
        return json(tx(() => this.workers.sendMessage(owner, body)));
      }
      if (p === '/v1/ui/suspensions') {
        const body = await readJson(req);
        return json(tx(() => this.workers.setSuspension(owner, body)));
      }
      const lift = /^\/v1\/ui\/suspensions\/(\d+)\/lift$/.exec(p);
      if (lift) return json(tx(() => this.workers.liftSuspension(owner, Number(lift[1]))));
      const reap = /^\/v1\/ui\/claims\/(\d+)\/reap$/.exec(p);
      if (reap) {
        const body = await readJson(req);
        return json(tx(() => this.claims.forceReap(owner, Number(reap[1]), body)));
      }
      const resolve = /^\/v1\/ui\/claims\/(\d+)\/resolve$/.exec(p);
      if (resolve) {
        const body = await readJson(req);
        return json(tx(() => this.claims.resolve(owner, Number(resolve[1]), body)));
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
      if (p === '/v1/ui/board/accept') {
        const body = await readJson(req);
        return json(tx(() => this.claims.acceptHeld(owner, body)));
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
    const seg = (raw: string) => {
      try {
        return decodeURIComponent(raw);
      } catch {
        throw new BatonError('invalid-params', 'a malformed path segment');
      }
    };
    if (p.startsWith('/v1/admin/')) {
      if (!admins.has(fp)) throw new BatonError('forbidden', 'an administrator’s key is required (R-BTN-57)');
      const actor = `admin:${fp}`;
      // B-90: the registry, for an operator or an agent with a key — no new query: the same
      // `uiRepo` rows `/v1/ui/state` lists as its `repositories`.
      if (m === 'GET' && p === '/v1/admin/repositories') return json(this.adminView());
      // B-118: what an administrator's dashboard session reads, for the key itself — the same
      // `uiState()`, so the dashboard and a terminal cannot drift.
      if (m === 'GET' && p === '/v1/admin/state') return json(this.uiState());
      if (m === 'POST' && p === '/v1/admin/repositories') return json(await this.admin.repositories(actor, await body()));
      if (m === 'POST' && p === '/v1/admin/probes') return json(await this.admin.addProbe(actor, await body()));
      // R-BTN-76: external resources, their account instances, and a reading by hand.
      if (m === 'POST' && p === '/v1/admin/resources') return json(this.resources.addResource(actor, await body()));
      if (m === 'POST' && p === '/v1/admin/instances') return json(this.resources.addInstance(actor, await body()));
      if (m === 'POST' && p === '/v1/admin/readings') return json(this.resources.post({ kind: 'admin', fingerprint: fp }, await body(), null));
      if (m === 'POST' && p === '/v1/admin/grants') {
        const b = await body();
        const repo = checkRepositoryId((b as { repository?: unknown } | null)?.repository);
        return json(await this.admin.grant(actor, repo, b, 'admin'));
      }
      const revoke = /^\/v1\/admin\/keys\/([^/]+)\/revoke$/.exec(p);
      if (m === 'POST' && revoke) return json(this.admin.revokeKey(actor, seg(revoke[1])));
      if (m === 'POST' && p === '/v1/admin/login-links') return json(await this.admin.loginLink(fp));
      throw new BatonError('not-found', `no route ${m} ${p}`);
    }
    const o = /^\/v1\/owner\/([^/]+)\/(.+)$/.exec(p);
    if (!o) throw new BatonError('not-found', `no route ${m} ${p}`);
    const repo = checkRepositoryId(seg(o[1]));
    // An administrator's key is no owner's, even one added as an owner before it was listed (R-BTN-57).
    if (admins.has(fp)) throw new BatonError('forbidden', 'an administrator key is never an owner key (R-BTN-57)');
    // Owning one repository confers nothing on another (R-BTN-58).
    if (!this.admin.owns(fp, repo)) throw new BatonError('forbidden', `this key does not own ${repo}`);
    const actor = `owner:${fp}`;
    const rest = o[2];
    // B-90: the repository's grants and settings, read before any write below.
    if (m === 'GET' && rest === 'grants') return json(this.grantsView(repo));
    if (m === 'POST' && rest === 'grants') return json(await this.admin.grant(actor, repo, await body(), 'owner'));
    const rg = /^grants\/([^/]+)\/revoke$/.exec(rest);
    if (m === 'POST' && rg) return json(this.admin.revokeGrant(actor, repo, seg(rg[1])));
    if (m === 'POST' && rest === 'owners') return json(await this.admin.owners(actor, repo, await body()));
    if (m === 'POST' && rest === 'bars') return json(this.admin.setBar(actor, repo, await body()));
    const lift = /^bars\/(\d+)\/lift$/.exec(rest);
    if (m === 'POST' && lift) return json(this.admin.liftBar(actor, repo, Number(lift[1])));
    if (m === 'PUT' && rest === 'settings') return json(this.admin.setSettings(actor, repo, await body()));
    if (m === 'POST' && rest === 'couriers') return json(await this.admin.couriers(actor, repo, await body()));
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
   * the day — acting as a worker courier on that repository's pool, with no worker secret. A key in
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
    } else if (cred?.kind === 'worker') {
      if (raw == null) throw new BatonError('invalid-params', 'repository: a machine key delivers one repository’s pool at a time (R-BTN-103)');
      const repository = checkRepositoryId(raw);
      if (!this.sql('SELECT 1 FROM worker_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', fp, repository).length) {
        throw new BatonError('forbidden', `the key is not granted on ${repository} (R-BTN-58)`);
      }
      const asks = this.notices.workerAsks(fp, repository);
      if (!asks.length) throw new BatonError('forbidden', `no session of this key declared couriers for ${repository} within the day (R-BTN-103)`);
      who = { kind: 'worker', fingerprint: fp, repository, asks };
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

  /** The repositories a worker key works on (R-BTN-58), or null for a key no owner or
   *  administrator granted — a bearer token or a seed key, which reaches every one. */
  private grantedRepos(cred: string): string[] | null {
    if (!this.workers.credential(cred).granted) return null;
    return this.sql<{ repository_id: string }>('SELECT repository_id FROM worker_grants WHERE credential_id = ? AND revoked_at IS NULL', cred).map((r) => r.repository_id);
  }

  /**
   * `GET /v1/repositories/{repository}/tickets/{ticket}/blocks[?worker=me]` and
   * `GET /v1/repositories/{repository}/blocked[?on=…&transitive=1 | ?cursor=…]` (R-BTN-75, §11):
   * for any key granted on the repository, an owner of it, or an administrator. `worker=me` is a
   * worker session's own answer, so it needs the session's secret.
   */
  private async blocksRoute(req: Request, url: URL): Promise<Response | null> {
    const blocks = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/blocks$/.exec(url.pathname);
    const blocked = /^\/v1\/repositories\/([^/]+)\/blocked$/.exec(url.pathname);
    // R-BTN-81: a ticket's history, read by the principals that may read its blocks (§11).
    const history = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/history$/.exec(url.pathname);
    // B-90: the dashboard's view of one repository, for the same principals — an administrator
    // sees any, an owner its own, a granted key the repositories it is granted on.
    const boardRead = /^\/v1\/repositories\/([^/]+)\/board$/.exec(url.pathname);
    if (req.method !== 'GET' || (!blocks && !blocked && !history && !boardRead)) return null;
    const seg = (raw: string) => {
      try {
        return decodeURIComponent(raw);
      } catch {
        throw new BatonError('invalid-params', 'a malformed path segment');
      }
    };
    const repo = checkRepositoryId(seg((blocks ?? blocked ?? history ?? boardRead)![1]));
    if (!this.registry.get(repo)) throw new BatonError('not-found', `no repository ${repo}`);
    let cred = req.headers.get('X-Baton-Credential');
    let role: 'admin' | 'owner' | 'worker' = 'worker';
    if (req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key')) {
      const admins = await this.admin.adminFingerprints();
      const v = await this.authenticated(req, (fp) => admins.get(fp) ?? this.admin.ownerKey(fp) ?? this.workers.publicKey(fp));
      cred = v.cred;
      role = admins.has(cred) ? 'admin' : this.admin.ownerKey(cred) ? 'owner' : 'worker';
      if (role === 'owner' && !this.admin.owns(cred, repo)) throw new BatonError('forbidden', `this key does not own ${repo}`);
    }
    if (!cred) throw new BatonError('unauthenticated', 'no principal');
    // R-BTN-179 (B-90): a granted key's board names its grant on THIS repository — the same grant the
    // heartbeat's answer names for it (workerApi.grantedCapabilities), 'none' left out — and
    // null for a key no grant binds there (a bearer's or a seed key's reach is its own).
    let granted: string[] | null = null;
    if (role === 'worker') {
      if (!this.sql('SELECT 1 FROM worker_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', cred, repo).length) {
        throw new BatonError('forbidden', `the key is not granted on ${repo} (R-BTN-58)`);
      }
      const c = this.workers.credential(cred);
      const row = c.granted ? this.sql<{ capabilities: string }>(
        'SELECT capabilities FROM worker_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', cred, repo)[0] : null;
      granted = row ? [...new Set(JSON.parse(row.capabilities) as string[])].filter((x) => x !== 'none').sort() : null;
    }
    if (boardRead) return json(this.boardView(repo, granted));
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
      return json(this.history.list(id, b, n));
    }
    if (blocks) {
      const raw = seg(blocks[2]);
      const id = raw.includes(':') ? raw : qualify(repo, raw);
      if (!TICKET_ID.test(id) || repositoryOf(id) !== repo) throw new BatonError('invalid-params', `ticket: must be a ticket of ${repo}`);
      let worker: number | null = null;
      const who = url.searchParams.get('worker');
      if (who != null) {
        if (who !== 'me' || role !== 'worker') throw new BatonError('invalid-params', 'worker: only `me`, from a worker session');
        worker = await this.workers.authWorker(cred, req.headers.get('X-Worker-Secret'));
      }
      return json(this.blocks.blocksOf(id, worker));
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
  // @model syncPost sha256:710161d0a3b7
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
    const head = this.headOf(r);
    const at = this.now();
    const normative = p.tickets !== undefined;
    const ticketCount = normative ? p.tickets!.length : p.state!.items.length;
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
        const seen = normative ? this.refreshStations(r, p, n, at, true) : new Map<string, Seen>();
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
    if (p.sha === head) {
      // §7.1 step 4: a refresh — the board's tickets unchanged, its stations, paths, next legs and
      // closures replaced. Its registry is not applied: the sync builds that body at the commit it
      // fetched, which may be an ancestor of the head, and an older registry would roll a course
      // back. A refresh is a reading like any other: it confirms ends and judges claims made
      // before its number (R-BTN-62, R-BTN-35), not only the post that moved the head.
      return this.store.transaction(() => {
        this.observations.accept(r, n);
        const seen = normative ? this.refreshStations(r, p, n, at) : new Map<string, Seen>();
        const confirmed = this.claims.confirm(confirmations, n);
        const judged = this.claims.judge(r, n, seen);
        return { ok: true, unchanged: true, confirmed: confirmed + judged.confirmed, stale_released: judged.stale_released };
      });
    }
    if (!accepted && p.parent_sha !== head) throw new BatonError('head-moved', `the head is ${head ?? 'unset'}; re-read it and retry`);

    // Hash every row before the transaction: the digest is async, the transaction is not.
    const rankOf = new Map((p.ready ?? []).map((id, i) => [id, i]));
    const posted = normative ? p.tickets!.map(rowForTicket) : p.state!.items.map((it) => rowFor(it, rankOf));
    const rows = await Promise.all(posted.map(async (base) => {
      // R-BTN-66: tiers arrive by name and are matched as positions in this repository's ladder.
      const row = { ...base, tier_position: tierPosition(repo.tiers, base.tier ?? null) };
      return { row, hash: await rowHash(row) };
    }));
    const changed: { upserted: number; deleted: number; confirmed?: number; stale_released?: number; courses_refused?: string[]; fleet_ignored?: boolean; dropped?: string[] } = { upserted: 0, deleted: 0 };
    this.store.transaction(() => {
      // The row hashes were awaited after the number was used, so another run may have posted
      // meanwhile: this reading must still be the newest, over the head it was judged against.
      if (!this.observations.newest(r, n)) throw new BatonError('stale-observation', `a newer reading than ${n} was accepted while this post was judged; take a new number and retry (R-BTN-62)`);
      if (this.headOf(r) !== head) throw new BatonError('head-moved', `the head moved to ${this.headOf(r) ?? 'unset'} while this post was judged; re-read it and retry`);
      // The course registry first (R-BTN-48, R-BTN-69): every ticket must name a course in
      // force, and a refused file with none to keep refuses the whole post.
      const refused = this.applyRegistry(r, p, rows.map(({ row }) => row.course_id), at);
      if (refused.length) changed.courses_refused = refused;
      const legsBefore = this.queuedLegs(r);
      const upserted: string[] = [];
      // The repository's own tickets only, keyed by their local ids (R-BTN-47).
      const have = new Map(this.sql<{ local_id: string; row_hash: string }>('SELECT local_id, row_hash FROM tickets WHERE repository_id = ?', r).map((x) => [x.local_id, x.row_hash]));
      for (const { row, hash } of rows) {
        const before = have.get(row.id);
        have.delete(row.id);
        if (before === hash) continue;
        const id = qualify(r, row.id);
        this.store.exec(
          `INSERT INTO tickets (id, repository_id, local_id, path, title, project, status, node, queue, tags, tier, requires_clause, operator_only,
             depends_on, blocked_by, repos, ord, rank, snapshot_sha, row_hash, since, holder, course_id, tier_position, expedite, display)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET path = excluded.path, title = excluded.title, project = excluded.project,
             status = excluded.status, node = excluded.node, queue = excluded.queue, tags = excluded.tags,
             tier = excluded.tier, requires_clause = excluded.requires_clause, operator_only = excluded.operator_only,
             depends_on = excluded.depends_on, blocked_by = excluded.blocked_by, repos = excluded.repos,
             ord = excluded.ord, rank = excluded.rank, snapshot_sha = excluded.snapshot_sha, row_hash = excluded.row_hash,
             since = excluded.since, holder = excluded.holder, course_id = excluded.course_id, tier_position = excluded.tier_position,
             expedite = excluded.expedite, display = excluded.display`,
          id, r, row.id, row.path, row.title, row.project, row.status, row.node, row.queue, row.tags, row.tier,
          row.requires_clause, row.operator_only, row.depends_on, row.blocked_by, row.repos, row.ord, row.rank, p.sha, hash, row.since, row.holder, row.course_id,
          row.tier_position, row.expedite, row.display);
        this.store.exec('DELETE FROM ticket_requires WHERE ticket_id = ?', id);
        for (const name of row.requires) this.store.exec('INSERT INTO ticket_requires (ticket_id, name) VALUES (?, ?)', id, name);
        changed.upserted++;
        upserted.push(id);
      }
      // Tickets no longer live leave the cache (R-BTN-35); their claims and events stay.
      for (const gone of have.keys()) {
        const id = qualify(r, gone);
        this.stations.clear(id);
        this.blocks.forget(id);
        this.store.exec('DELETE FROM ticket_requires WHERE ticket_id = ?', id);
        this.store.exec('DELETE FROM tickets WHERE id = ?', id);
        this.queues.touch(id);
        changed.deleted++;
      }
      // Where each ticket is (R-BTN-70): the normative post's stations, or the interim post's
      // placement at each course's start; and the closures it reports (R-BTN-10).
      const stations = normative
        ? new Map(Object.entries(p.stations ?? {}).map(([id, st]) => [id, stationOf(st)] as [string, PostedStation]))
        : this.stations.interim(r, p.state!.items.map((it) => ({ id: it.id, course: it.course ?? DEFAULT_COURSE, node: it.node })));
      // A live ticket the post does not place is placed nowhere: it is not offered on old data.
      for (const { row } of rows) if (!stations.has(row.id)) this.stations.clear(qualify(r, row.id));
      this.stations.reopened(r, rows.map(({ row }) => row.id));
      const seen = this.stations.apply(r, p.sha, n, stations, p.closed ?? [], at);
      // R-BTN-75–78: the snapshot's causes — `blocked_by`, `requires`, `needs`, `decisions` and
      // where each ticket is queued — rewrite the changed tickets' blocks in this transaction.
      const dropped = this.applyBlocks(r, stations, upserted, legsBefore, changed.deleted > 0);
      if (dropped.length) changed.dropped = dropped.slice(0, 100);
      // A non-fleet repository's fleet fields are ignored, and its answer says so.
      if (this.reference(r, p)) changed.fleet_ignored = true;
      this.store.exec('INSERT INTO board_snapshots (repository_id, sha, parent_sha, received_at, ticket_count) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repository_id, sha) DO NOTHING', r, p.sha, p.parent_sha, at, ticketCount);
      this.store.exec('INSERT INTO board_head (repository_id, sha) VALUES (?, ?) ON CONFLICT (repository_id) DO UPDATE SET sha = excluded.sha', r, p.sha);
      // A hold is against one head (R3-1223): when the head moves — an accepted rewrite or a
      // plain fast-forward — every row held against the head it leaves is retired, answered or
      // not. Left in place, an accepted row would accept a NEW rewrite silently whenever the
      // head came back to that sha; an unanswered one is moot (main moved on), and a re-post of
      // its sha is held afresh. So every row left is a hold against the current head. Their
      // history stays in the events.
      this.store.exec('DELETE FROM held_snapshots WHERE repository_id = ? AND head_sha IS ?', r, head);
      this.event(r, 'snapshot-accepted', { sha: p.sha, parent_sha: p.parent_sha, ticket_count: ticketCount, ...changed, ...(accepted ? { held: true } : {}) }, at);
      this.observations.accept(r, n);
      const confirmed = this.claims.confirm(confirmations, n);
      // R-BTN-10, R-BTN-35, §2e: git confirms ends, takes tickets away and goes backwards.
      const judged = this.claims.judge(r, n, seen);
      changed.confirmed = confirmed + judged.confirmed;
      changed.stale_released = judged.stale_released;
    });
    return { ok: true, ...changed };
  }

  /** A refresh's stations (§7.1, R-BTN-62): the head's tickets unchanged, where each is replaced. */
  private refreshStations(r: string, p: BoardPayload, n: number, at: number, held = false): Map<string, Seen> {
    const live = new Set(this.sql<{ local_id: string }>('SELECT local_id FROM tickets WHERE repository_id = ?', r).map((t) => t.local_id));
    const stations = new Map(Object.entries(p.stations ?? {}).filter(([id]) => live.has(id)).map(([id, st]) => [id, stationOf(st)] as [string, PostedStation]));
    // As on a new head: a live ticket the refresh does not place is placed nowhere, never offered
    // on an old station (round 1, 1-A-0, 1-B-0).
    const legsBefore = this.queuedLegs(r);
    for (const id of live) if (!stations.has(id)) this.stations.clear(qualify(r, id));
    // A held history's closures stand even for tickets the current head still has: the holder's
    // archive may be in the rewritten history alone, and its done end must not wait the hold's
    // 24 hours (R-BTN-62; round 2, 2-A-0). A plain refresh of the head cannot close what it has.
    const seen = this.stations.apply(r, p.sha, n, stations, (p.closed ?? []).filter((c) => held || !live.has(c.id)), at);
    // A refresh's stations carry `needs` and `decisions` too (R-BTN-76, R-BTN-78).
    this.applyBlocks(r, stations, [], legsBefore);
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

  /** The registry of a post (R-BTN-48, R-BTN-69), inside its transaction: applied whole, then
   *  every course the post's tickets name must be in force — a refused file with none to keep,
   *  or a course the registry dropped while a ticket still names it, refuses the post. */
  private applyRegistry(r: string, p: BoardPayload, ticketCourses: string[], at: number): string[] {
    const refused = p.registry ? this.courses.apply(r, p.registry, p.sha, at) : [];
    this.stations.reset();
    for (const c of new Set(ticketCourses)) {
      if (!this.courses.get(r, c)) throw new BatonError('invalid-params', `a ticket's course ${c} is not in ${r}'s registry`);
    }
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

  /** The reference data the sync posts with every snapshot (§7.3, §7.4): providers, peak
   *  schedules, per-model prices and limits, the reviewer catalog. Each
   *  table is a copy of a docs file, never edited here, so it is rewritten whole: an account
   *  the file no longer lists is deleted. (Nothing references `model_providers` yet; when
   *  workers and suspensions do, R3-1211 decides what retiring a referenced account means.)
   *  Returns whether the payload carried fleet data this repository may not write. */
  private reference(repo: string, p: BoardPayload): boolean {
    const exec = (q: string, ...a: unknown[]) => this.store.exec(q, ...a);
    // §6.8, R-BTN-66: a repository's transcript repositories are its owners' setting, never read
    // from a board post (R3-1240); a sync that still sends them is not refused for it.
    // The rest is the instance's: only the fleet repository writes it (interim, R3-1231 2b).
    const carries = p.providers != null || p.matrix != null || p.reviewers != null;
    if (this.registry.fleetRepository() !== repo) return carries;
    if (p.providers) {
      exec('DELETE FROM provider_models');
      const ids = p.providers.accounts.map((a) => a.id);
      exec(`DELETE FROM model_providers WHERE id NOT IN (${ids.map(() => '?').join(', ') || "''"})`, ...ids);
      for (const a of p.providers.accounts) {
        exec(`INSERT INTO model_providers (id, name, billing, window_limits_json) VALUES (?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET name = excluded.name, billing = excluded.billing, window_limits_json = excluded.window_limits_json`,
          a.id, a.name, a.billing, a.window_limits ? JSON.stringify(a.window_limits) : null);
      }
      exec('DELETE FROM peak_schedules');
      for (const s of p.providers.peak_schedules) exec('INSERT INTO peak_schedules (id, rules_json, factor) VALUES (?, ?, ?)', s.id, JSON.stringify(s.rules), s.factor);
      for (const m of p.providers.models) {
        const price = priceFor(m.model, p.prices);
        exec(`INSERT INTO provider_models (provider_id, model_id, input_per_m, output_per_m, cache_read_per_m, cache_write_per_m, monthly_limit_usd, peak_schedule_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          m.provider, m.model, price?.input ?? null, price?.output ?? null, price?.cacheRead ?? null, price?.cacheWrite5m ?? null, m.monthly_limit_usd, m.peak_schedule ?? null);
      }
    }
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

  /** One registered repository as `/v1/ui/state` lists it (B-90: `baton board` reads the same):
   *  its own head and its own mode (R-BTN-47, R-BTN-28), and its courses with their queues. */
  private uiRepo(repo: Repository) {
    const sha = this.headOf(repo.id);
    const head = sha ? this.sql('SELECT sha, parent_sha, received_at, ticket_count FROM board_snapshots WHERE repository_id = ? AND sha = ?', repo.id, sha)[0] ?? null : null;
    const courses = this.courses.all().filter((c) => c.repository_id === repo.id).map(({ id, version, min_worker_version, skill }) => ({ id, version, min_worker_version, skill,
        // R-BTN-79: the course's intake and each of its queues, for the Courses view.
        intake: this.queues.intake(repo.id, id), queues: this.queues.legs(repo.id, id).map(({ leg, depth, max_queue }) => ({ leg, depth, max_queue })) }));
    return { id: repo.id, github: repo.github, forge: repo.forge, web_base: repo.web_base, default_branch: repo.default_branch, weight: repo.weight, head, mode: this.workers.mode(repo.id), courses };
  }

  /** `GET /v1/admin/repositories` (B-90): the registry as the dashboard's state lists it, every
   *  registered repository with its head, mode and courses. */
  adminView() {
    // One section of `uiState`'s answer, built by the same `uiRepo` it maps over.
    return { repositories: this.registry.all().map((repo) => this.uiRepo(repo)) };
  }

  /** `GET /v1/owner/{repository}/grants` (R-BTN-146, B-90): the repository's owner keys, the
   *  grants on it, and its owners' settings — the dashboard's state's own reads, for its owners. */
  grantsView(repo: string) {
    // The same three reads `uiState().limits` serves, over one repository: owners, grants (their
    // max_tier as its name in the repository's ladder) and settings.
    const limits = this.admin.view(this.now());
    return {
      repository: repo,
      owners: limits.owners.filter((o) => o.repository_id === repo),
      // R-BTN-58: a key granted here may be granted elsewhere too, and its holder decides once
      // for all of them — so each row also names the other repositories that key holds
      // (`other_repositories`, revoked grants excluded).
      grants: limits.grants.filter((g) => g.repository_id === repo).map((g) => ({
        credential_id: g.credential_id, hostname: g.hostname, label: g.label, repository_id: g.repository_id,
        capabilities: g.capabilities, max_tier: g.max_tier, granted_by: g.granted_by, granted_at: g.granted_at,
        other_repositories: limits.grants.filter((o) => o.credential_id === g.credential_id && o.repository_id !== repo).map((o) => o.repository_id).sort(),
      })),
      settings: limits.settings.find((s) => s.repository_id === repo) ?? null,
      // R-BTN-67: the bars in force and scheduled, always carrying their repository's id.
      bars: limits.bars.filter((b) => (b as { repository_id: string }).repository_id === repo),
      server_time: this.now(),
    };
  }

  /** `GET /v1/repositories/{repository}/board` (B-90): the dashboard's view of one repository —
   *  the repository as `/v1/ui/state` lists it, its `ready` tickets and the per-tier order,
   *  derived by the same `readyRows` it derives them with, for one repository — and one field the
   *  dashboard does not have. `granted_capabilities` is the key's grant's capabilities — the
   *  heartbeat answer's field — so a granted runner knows its grant from the read alone; null
   *  for a key no grant binds and for an owner's or an administrator's key. */
  boardView(repo: string, granted: string[] | null = null) {
    const now = this.now();
    const repository = this.uiRepo(this.registry.get(repo)!);
    const ready = this.readyRows([repository], repo);
    return {
      repository,
      ready,
      ready_by_tier: this.readyByTier(ready, [repo]),
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
              t.expedite, t.snapshot_sha, s.station, s.next_leg, s.to_end
       FROM tickets t JOIN repositories p ON p.id = t.repository_id
       JOIN ticket_stations s ON s.ticket_id = t.id
       JOIN ticket_next_legs a ON a.ticket_id = t.id AND a.leg = s.next_leg AND a.state = 'ready'
       WHERE p.retired_at IS NULL${repository_id ? ' AND t.repository_id = ?' : ''} ORDER BY p.weight DESC, t.expedite DESC, s.to_end, t.rank IS NULL, t.rank, t.repository_id, t.id`,
      ...(repository_id ? [repository_id] : []));
    const requires = new Map<string, string[]>();
    for (const r of this.sql<{ ticket_id: string; name: string }>('SELECT ticket_id, name FROM ticket_requires ORDER BY name')) {
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

  /** Per tier ceiling, the order a worker under it would be offered (§13 step 1's exit). Each
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

  uiState() {
    const now = this.now();
    // Each registered repository: its own head and its own mode (R-BTN-47, R-BTN-28).
    const repositories = this.adminView().repositories;
    const ready = this.readyRows(repositories);
    const byTier = this.readyByTier(ready);

    const schedules = new Map(this.sql<{ id: string; rules_json: string; factor: number }>('SELECT id, rules_json, factor FROM peak_schedules').map((s) => [s.id, s]));
    const providers = this.sql<{ id: string; name: string; billing: string; window_limits_json: string | null }>('SELECT id, name, billing, window_limits_json FROM model_providers ORDER BY id').map((a) => {
      const models = this.sql<{ model_id: string; monthly_limit_usd: number | null; peak_schedule_id: string | null }>(
        'SELECT model_id, monthly_limit_usd, peak_schedule_id FROM provider_models WHERE provider_id = ? ORDER BY model_id', a.id);
      const peaks = [...new Set(models.map((m) => m.peak_schedule_id).filter((x): x is string => !!x))].map((id) => {
        const s = schedules.get(id);
        if (!s) return { schedule: id, in_peak: null, next_change: null, factor: null };
        const rules = JSON.parse(s.rules_json);
        return { schedule: id, in_peak: inPeak(rules, now), next_change: nextPeakChange(rules, now), factor: s.factor, models: models.filter((m) => m.peak_schedule_id === id).map((m) => m.model_id) };
      });
      return { id: a.id, name: a.name, billing: a.billing, window_limits: a.window_limits_json ? JSON.parse(a.window_limits_json) : null, models, peaks };
    });

    const held = this.sql(
      `SELECT repository_id, sha, parent_sha, head_sha, ticket_count, received_at, auto_accept_at FROM held_snapshots
       WHERE accepted_at IS NULL ORDER BY received_at`);
    const suspensions = this.sql(`SELECT id, provider_id, model_id, mode, starts_at, ends_at, reason, set_by, lifted_at FROM provider_suspensions
                                  WHERE lifted_at IS NULL AND (ends_at IS NULL OR ends_at > ?) ORDER BY starts_at`, now);
    return {
      server_time: now, repositories, ready, ready_by_tier: byTier, providers, held, workers: this.workers.workersView(now), suspensions,
      running: this.claims.running(now), timeline: this.claims.timeline(now),
      // R-BTN-66: owners, grants, owner bars and settings — read-only; the CLI changes them.
      limits: this.admin.view(now),
      // R-BTN-69: a refused course file, the previous one staying in force.
      needs_you: { ...this.claims.needsYou(now), ...this.blocks.needsYou(now), ...this.notices.needsYou(now), ...this.stations.needsYou(), adoptions: this.cutover.adoptions(), courses_refused: this.courses.refusals(), keys: this.keysNotice() },
      // R-BTN-75, R-BTN-76: each blocked ticket with its blocks, and the instances' states.
      blocked: this.blocks.view(),
      // R-BTN-85: the disagreements with git of the last 7 days, by kind.
      discrepancies: this.history.view(now),
      resources: this.resources.view(now),
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
