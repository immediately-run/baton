// resources.ts — external resources, their instances and the instruments' readings (BATON_SPEC §2g
// R-BTN-76, §2l R-BTN-101; R3-1251). Per Baton, not per repository: an administrator registers a
// resource (its scope and its readings' `detail` schema) and each account instance (what it serves,
// which repositories' workers may use it); a worker declares the account instances it uses in its
// heartbeat; workers, probes and administrators post readings, each kept per instrument and each
// lapsing on its own. An instance's state — the administrator's reading while in force, else the
// most recently observed `state` reading in force, else `unknown` — is evaluated here, stored, and
// each change is a `resource` event that the blocks recount from. Core reads the envelope, never
// `detail`, and no name here means anything.
import { BatonError } from './http';
import { logEvent } from './db';
import { baseChainOf, detailProblem, sameSchema, schemaProblem, type Schema } from './detailSchema';
import { refinementGaps } from '../shared/schema.mjs';
import { stdSchema } from '../shared/std.mjs';
import { checkInstance, checkReadings, checkResource, VALID_FOR, WORKER_INSTANCE } from './validate';
import type { Blocks } from './blocks';
import type { Store } from './ports';

/** R-BTN-76: at most one reading per worker, instance and kind a minute. */
export const WORKER_READING_EVERY_MS = 60_000;

export interface Ctx {
  store: Store;
  now: () => number;
  blocks: Blocks;
}

/** Who posts a reading: a worker session, a probe key, or an administrator. */
export type Instrument =
  | { kind: 'worker'; workerId: number; credential: string }
  | { kind: 'probe'; fingerprint: string }
  | { kind: 'admin'; fingerprint: string };

export type InstanceState = 'available' | 'unavailable' | 'unknown';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export class Resources {
  constructor(private readonly c: Ctx) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }

  // ── registration (an administrator, R-BTN-76) ─────────────────────────────────────────────

  /** `POST /v1/admin/resources`: `{name, scope, detail_schema, atoms_from?}`. The schema is refused outside
   *  R-BTN-76's subset; an `x-baton-base` names a `std:` schema (and only one — R-BTN-176), and a
   *  refinement R-BTN-108's check cannot prove is refused, its chain stored for `refines` atoms.
   *  A `service` resource is its own one instance. Registering a name again is idempotent only
   *  with the same scope and schema: instances and readings were judged by them; the same pair may
   *  still change `atoms_from`, logged as an `admin` event (R-BTN-176). */
  addResource(actor: string, body: unknown) {
    const r = checkResource(body);
    const problem = schemaProblem(r.detail_schema);
    if (problem) throw new BatonError('invalid-params', `detail_schema: ${problem} (R-BTN-76's subset)`);
    if (!isObj(r.detail_schema)) throw new BatonError('invalid-params', 'detail_schema: must be an object');
    // R-BTN-176: the base is a `std:` schema — only a std: schema — and the refinement is proved
    // (R-BTN-108's check, sound but conservative: what it cannot prove is refused). Core stores
    // the named chain; it never resolves the schemas again.
    const schema = r.detail_schema as Schema;
    const chain = baseChainOf(schema, stdSchema);
    if (typeof schema['x-baton-base'] === 'string') {
      const base = schema['x-baton-base'];
      if (!base.startsWith('std:')) throw new BatonError('invalid-params', `detail_schema.x-baton-base: ${base} — only a std: schema is a base (R-BTN-176)`);
      const target = stdSchema(base);
      if (!target) throw new BatonError('invalid-params', `detail_schema.x-baton-base: ${base} is not in the std: library (R-BTN-176)`);
      for (const id of chain) {
        if (!stdSchema(id)) throw new BatonError('invalid-params', `detail_schema.x-baton-base: ${id} is not in the std: library (R-BTN-176)`);
      }
      const gaps = refinementGaps(schema, target, stdSchema);
      if (gaps.length) throw new BatonError('invalid-params', `detail_schema: does not refine ${base} — ${gaps[0].path || '/'} ${gaps[0].keyword} ${gaps[0].message} (R-BTN-108)`);
    }
    return this.c.store.transaction(() => {
      const now = this.c.now();
      const known = this.rows<{ scope: string; detail_schema: string; atoms_from: string }>('SELECT scope, detail_schema, atoms_from FROM external_resources WHERE name = ?', r.name)[0];
      if (known) {
        if (known.scope !== r.scope || !sameSchema(JSON.parse(known.detail_schema), r.detail_schema as Schema)) {
          throw new BatonError('conflict', `${r.name} is registered with another scope or schema`);
        }
        if (known.atoms_from !== r.atoms_from) {
          this.exec('UPDATE external_resources SET atoms_from = ? WHERE name = ?', r.atoms_from, r.name);
          logEvent(this.c.store, now, 'admin', actor, { act: 'resource-atoms-from', name: r.name, atoms_from: r.atoms_from }, null, null, null);
        }
        return { ok: true };
      }
      if (this.rows('SELECT 1 FROM resource_instances WHERE name = ?', r.name).length) throw new BatonError('conflict', `${r.name} is already an instance's name`);
      this.exec('INSERT INTO external_resources (name, scope, detail_schema, atoms_from, base_chain_json) VALUES (?, ?, ?, ?, ?)', r.name, r.scope, JSON.stringify(r.detail_schema), r.atoms_from, JSON.stringify(chain));
      if (r.scope === 'service') {
        this.exec(`INSERT INTO resource_instances (name, repositories) VALUES (?, '[]')`, r.name);
        this.exec('INSERT INTO instance_serves (instance, resource) VALUES (?, ?)', r.name, r.name);
        this.exec(`INSERT INTO instance_states (instance, state, changed_at) VALUES (?, 'unknown', ?) ON CONFLICT (instance) DO NOTHING`, r.name, now);
      }
      logEvent(this.c.store, now, 'admin', actor, { act: 'resource-added', name: r.name, scope: r.scope, ...(chain.length ? { refines: chain } : {}), ...(r.atoms_from !== 'admin' ? { atoms_from: r.atoms_from } : {}) }, null, null, null);
      this.c.blocks.instancesChanged([r.name]);
      return { ok: true };
    });
  }

  /** `POST /v1/admin/instances`: an account instance `{name, serves, repositories}`, re-posted to
   *  change either. Every resource it serves is an `account` one, and they share one schema, so
   *  one reading is the state of each. */
  addInstance(actor: string, body: unknown) {
    const i = checkInstance(body);
    return this.c.store.transaction(() => {
      const now = this.c.now();
      if (this.rows('SELECT 1 FROM external_resources WHERE name = ?', i.name).length) throw new BatonError('conflict', `${i.name} is a resource's name`);
      const served = this.rows<{ name: string; scope: string; detail_schema: string }>(
        'SELECT name, scope, detail_schema FROM external_resources WHERE name IN (SELECT value FROM json_each(?)) ORDER BY name', JSON.stringify(i.serves));
      const missing = i.serves.filter((s) => !served.some((x) => x.name === s));
      if (missing.length) throw new BatonError('not-found', `serves: ${missing.join(', ')} is not a registered resource`);
      const notAccount = served.filter((x) => x.scope !== 'account').map((x) => x.name);
      if (notAccount.length) throw new BatonError('invalid-params', `serves: ${notAccount.join(', ')} is not an account resource; only account resources have registered instances`);
      const first = JSON.parse(served[0].detail_schema) as Schema;
      if (!served.every((x) => sameSchema(first, JSON.parse(x.detail_schema)))) throw new BatonError('invalid-params', 'serves: the resources one instance serves must share one detail schema (R-BTN-76)');
      const unknown = i.repositories.filter((r) => !this.rows('SELECT 1 FROM repositories WHERE id = ? AND retired_at IS NULL', r).length);
      if (unknown.length) throw new BatonError('not-found', `repositories: ${unknown.join(', ')} is not registered`);
      const fresh = !this.rows('SELECT 1 FROM resource_instances WHERE name = ?', i.name).length;
      this.exec(`INSERT INTO resource_instances (name, repositories) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET repositories = excluded.repositories`, i.name, JSON.stringify(i.repositories));
      this.exec('DELETE FROM instance_serves WHERE instance = ?', i.name);
      for (const s of i.serves) this.exec('INSERT INTO instance_serves (instance, resource) VALUES (?, ?)', i.name, s);
      // `unknown` from registration: a day of it while a leg needs the instance is Needs you.
      if (fresh) this.exec(`INSERT INTO instance_states (instance, state, changed_at) VALUES (?, 'unknown', ?) ON CONFLICT (instance) DO NOTHING`, i.name, now);
      logEvent(this.c.store, now, 'admin', actor, { act: fresh ? 'instance-added' : 'instance-changed', name: i.name, serves: i.serves, repositories: i.repositories }, null, null, null);
      this.c.blocks.instancesChanged([i.name]);
      return { ok: true };
    });
  }

  // ── what a worker uses (the heartbeat's `uses`) ───────────────────────────────────────────

  /** R-BTN-76: the account instances a worker declares it uses, each registered and listing a
   *  repository its key works on; the rest are returned with why, and the heartbeat still
   *  succeeds. Rewrites `worker_instances` only when it changes; returns whether it did. */
  applyUses(workerId: number, repos: string[] | null, names: string[]): { changed: boolean; refused: { instance: string; code: string }[] } {
    const refused: { instance: string; code: string }[] = [];
    const keep: string[] = [];
    for (const name of names) {
      const inst = this.rows<{ repositories: string }>(
        `SELECT i.repositories FROM resource_instances i WHERE i.name = ?
           AND EXISTS (SELECT 1 FROM instance_serves s JOIN external_resources e ON e.name = s.resource WHERE s.instance = i.name AND e.scope = 'account')`, name)[0];
      if (!inst) {
        refused.push({ instance: name, code: 'not-found' });
        continue;
      }
      const listed = JSON.parse(inst.repositories) as string[];
      if (repos !== null && !listed.some((r) => repos.includes(r))) {
        refused.push({ instance: name, code: 'forbidden' });
        continue;
      }
      keep.push(name);
    }
    const before = this.rows<{ instance: string }>('SELECT instance FROM worker_instances WHERE worker_id = ? ORDER BY instance', workerId).map((r) => r.instance);
    const after = [...keep].sort();
    if (before.join('\u0000') === after.join('\u0000')) return { changed: false, refused };
    this.exec('DELETE FROM worker_instances WHERE worker_id = ?', workerId);
    for (const name of after) this.exec('INSERT INTO worker_instances (worker_id, instance) VALUES (?, ?)', workerId, name);
    return { changed: true, refused };
  }

  // ── readings (R-BTN-76, R-BTN-101) ────────────────────────────────────────────────────────

  /** The resources an instance serves, with their schemas — none when it is no registered
   *  instance (a worker instance is one of a registered `worker` resource). */
  private servedBy(instance: string): { resource: string; scope: string; schema: Schema }[] {
    const w = WORKER_INSTANCE.exec(instance);
    if (w) {
      // Only a worker that exists has an instance: nothing makes rows for an imagined one.
      if (!this.rows('SELECT 1 FROM workers WHERE id = ?', Number(w[2])).length) return [];
      const r = this.rows<{ scope: string; detail_schema: string }>(`SELECT scope, detail_schema FROM external_resources WHERE name = ? AND scope = 'worker'`, w[1])[0];
      return r ? [{ resource: w[1], scope: r.scope, schema: JSON.parse(r.detail_schema) }] : [];
    }
    return this.rows<{ resource: string; scope: string; detail_schema: string }>(
      `SELECT s.resource, e.scope, e.detail_schema FROM instance_serves s JOIN external_resources e ON e.name = s.resource WHERE s.instance = ? ORDER BY s.resource`, instance)
      .map((r) => ({ resource: r.resource, scope: r.scope, schema: JSON.parse(r.detail_schema) }));
  }

  /** Whether `who` may report on `instance` (R-BTN-101): an administrator and a probe on any
   *  registered instance; a worker on its own worker instances and on any account instance that
   *  lists a repository its key works on (`repos` null: a key with no grants, which reaches all). */
  private mayReport(who: Instrument, instance: string, served: { scope: string }[], repos: string[] | null): 'ok' | 'forbidden' {
    if (who.kind !== 'worker') return 'ok';
    const w = WORKER_INSTANCE.exec(instance);
    if (w) return Number(w[2]) === who.workerId ? 'ok' : 'forbidden';
    if (!served.every((s) => s.scope === 'account')) return 'forbidden';
    const listed = JSON.parse(this.rows<{ repositories: string }>('SELECT repositories FROM resource_instances WHERE name = ?', instance)[0]?.repositories ?? '[]') as string[];
    return repos === null || listed.some((r) => repos.includes(r)) ? 'ok' : 'forbidden';
  }

  /**
   * `POST /v1/runner/readings`, `/v1/probe/readings` and `/v1/admin/readings`: each reading checked
   * on its own — the envelope, the instance registered, who may report on it, `detail` against its
   * resources' schema — and stored as this instrument's latest of its kind; a refused one is
   * answered with its code, never the post. A `state` reading posted while an administrator's is
   * in force is stored and answered `overridden`.
   */
  // @model reading sha256:f9345e5715a2
  post(who: Instrument, body: unknown, repos: string[] | null) {
    const readings = checkReadings(body, who.kind === 'admin' ? VALID_FOR.admin_s : VALID_FOR.state_s);
    return this.c.store.transaction(() => {
      const now = this.c.now();
      const refused: { instance: string; code: string; message?: string }[] = [];
      const overridden: string[] = [];
      const touched = new Set<string>();
      const source = who.kind === 'admin' ? 'admin' : who.kind === 'probe' ? `probe:${who.fingerprint}` : `worker:${who.workerId}`;
      const postedBy = who.kind === 'admin' ? `admin:${who.fingerprint}` : source;
      for (const r of readings) {
        const served = this.servedBy(r.instance);
        if (!served.length) {
          refused.push({ instance: r.instance, code: 'not-found' });
          continue;
        }
        if (this.mayReport(who, r.instance, served, repos) === 'forbidden') {
          refused.push({ instance: r.instance, code: 'forbidden' });
          continue;
        }
        if (r.detail !== undefined) {
          const p = detailProblem(served.map((s) => s.schema), r.detail);
          if (p) {
            refused.push({ instance: r.instance, code: 'invalid-params', message: p });
            continue;
          }
        }
        if (who.kind === 'worker' && this.rows(`SELECT 1 FROM instance_readings WHERE instance = ? AND source = ? AND kind = ? AND observed_at > ?`,
          r.instance, source, r.kind, now - WORKER_READING_EVERY_MS).length) {
          refused.push({ instance: r.instance, code: 'rate-limited' });
          continue;
        }
        const end = now + r.valid_for_s * 1000;
        if (r.until != null && r.until > end) {
          refused.push({ instance: r.instance, code: 'invalid-params', message: 'until: is later than the reading’s end (valid_for)' });
          continue;
        }
        const lapses = r.kind === 'state' && !r.available && r.until != null ? Math.min(r.until, end) : end;
        // R-BTN-176 (B-105): a state reading without a detail never erases the fields — the
        // detail the instrument last carried stays in force with the new envelope, until a
        // reading carries a new one or the instrument's row lapses whole.
        const priorDetail = this.rows<{ detail: string | null }>('SELECT detail FROM instance_readings WHERE instance = ? AND source = ? AND kind = ?', r.instance, source, r.kind)[0]?.detail ?? null;
        const detail = r.detail === undefined && r.kind === 'state' ? priorDetail : r.detail === undefined ? null : JSON.stringify(r.detail);
        // §12.8 (B-145 item 9, R-BTN-181): the writer class the credential names, with the
        // nonce and signature a signed reading carries.
        const writer = who.kind === 'admin' ? 'admin' : who.kind === 'probe' ? 'instrument' : 'runner';
        this.exec(`INSERT INTO instance_readings (instance, source, kind, available, until, observed_at, lapses_at, detail, posted_by, writer, nonce, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (instance, source, kind) DO UPDATE SET available = excluded.available, until = excluded.until, observed_at = excluded.observed_at,
                     lapses_at = excluded.lapses_at, detail = excluded.detail, posted_by = excluded.posted_by, writer = excluded.writer, nonce = excluded.nonce, signature = excluded.signature`,
          r.instance, source, r.kind, r.kind === 'state' ? (r.available ? 1 : 0) : null, r.until, now, lapses, detail, postedBy, writer, r.nonce ?? null, r.signature ?? null);
        if (r.kind === 'state') {
          touched.add(r.instance);
          if (who.kind !== 'admin' && this.adminInForce(r.instance, now)) overridden.push(r.instance);
        }
      }
      this.refresh(touched);
      return { ok: true, refused, ...(who.kind === 'worker' || overridden.length ? { overridden } : {}) };
    });
  }

  private adminInForce(instance: string, now: number) {
    return this.rows(`SELECT 1 FROM instance_readings WHERE instance = ? AND source = 'admin' AND kind = 'state' AND lapses_at > ?`, instance, now).length > 0;
  }

  /** R-BTN-76 with R-BTN-101's precedence: the administrator's `state` reading while in force,
   *  else the most recently observed `state` reading in force, else `unknown`. */
  stateOf(instance: string, now = this.c.now()): { state: InstanceState; until: number | null } {
    const r = this.rows<{ available: number; until: number | null }>(
      `SELECT available, until FROM instance_readings WHERE instance = ? AND kind = 'state' AND lapses_at > ?
       ORDER BY source = 'admin' DESC, observed_at DESC LIMIT 1`, instance, now)[0];
    if (!r) return { state: 'unknown', until: null };
    return r.available ? { state: 'available', until: null } : { state: 'unavailable', until: r.until };
  }

  /** Re-evaluate these instances' states (every instance with a reading or a stored state when
   *  none is named): each change is stored and logged as a `resource` event, then all are
   *  recounted at once. A worker's implicit instance back at `unknown` with no reading left loses
   *  its row — one per worker session would otherwise accumulate for ever. */
  refresh(instances?: Iterable<string>) {
    const now = this.c.now();
    const names = instances ? [...instances] : this.rows<{ instance: string }>('SELECT instance FROM instance_states UNION SELECT instance FROM instance_readings').map((r) => r.instance);
    const changed: string[] = [];
    for (const name of names) {
      const s = this.stateOf(name, now);
      const stored = this.rows<{ state: InstanceState; until: number | null }>('SELECT state, until FROM instance_states WHERE instance = ?', name)[0];
      const transient = WORKER_INSTANCE.test(name) && s.state === 'unknown' && !this.rows('SELECT 1 FROM instance_readings WHERE instance = ?', name).length;
      if (transient && stored) this.exec('DELETE FROM instance_states WHERE instance = ?', name);
      if (stored?.state === s.state && stored.until === s.until) continue;
      if (!stored && s.state === 'unknown') continue;
      if (!transient) {
        this.exec(`INSERT INTO instance_states (instance, state, until, changed_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT (instance) DO UPDATE SET state = excluded.state, until = excluded.until,
                     changed_at = CASE WHEN instance_states.state = excluded.state THEN instance_states.changed_at ELSE excluded.changed_at END`,
          name, s.state, s.until, now);
      }
      if (stored?.state !== s.state) logEvent(this.c.store, now, 'resource', 'baton', { instance: name, state: s.state, ...(s.until != null ? { until: s.until } : {}), ...(stored ? { was: stored.state } : {}) }, null, null, null);
      changed.push(name);
    }
    this.c.blocks.instancesChanged(changed);
  }

  /** The alarm's share: lapsed readings are dropped (every reading in force is kept, R-BTN-101),
   *  and the states they held change. Returns when the next one lapses. */
  // @model readingLapses sha256:5a264f29fafa
  alarm(): number | null {
    const now = this.c.now();
    const lapsed = this.rows<{ instance: string }>('SELECT DISTINCT instance FROM instance_readings WHERE lapses_at <= ?', now).map((r) => r.instance);
    this.exec('DELETE FROM instance_readings WHERE lapses_at <= ?', now);
    this.refresh(lapsed);
    return this.nextLapse();
  }

  nextLapse(): number | null {
    return this.rows<{ t: number | null }>(`SELECT MIN(lapses_at) AS t FROM instance_readings WHERE kind = 'state'`)[0]?.t ?? null;
  }

  /** The instances, their states and the readings in force — for the dashboard (§14). */
  view(now: number) {
    return {
      resources: this.rows('SELECT name, scope FROM external_resources ORDER BY name'),
      instances: this.rows<{ name: string; repositories: string }>(`SELECT name, repositories FROM resource_instances ORDER BY name`).map((i) => ({
        name: i.name,
        repositories: JSON.parse(i.repositories) as string[],
        serves: this.rows<{ resource: string }>('SELECT resource FROM instance_serves WHERE instance = ? ORDER BY resource', i.name).map((r) => r.resource),
        ...this.stateOf(i.name, now),
      })),
    };
  }

  // ── route choices (R-BTN-176, B-105): what steers advice, never the fleet's blocks ────────

  /** The runner's usable instances per resource for a repository (R-BTN-76): the `service`
   *  instance, its own `worker`-scope instance, and the account instances in its `uses` that
   *  serve the resource and list the repository. (`host` instances are R-BTN-178's, B-106.) */
  usableFor(workerId: number, repo: string): [string, string][] {
    const out: [string, string][] = [];
    for (const r of this.rows<{ name: string; scope: string }>('SELECT name, scope FROM external_resources ORDER BY name')) {
      if (r.scope === 'service') out.push([r.name, r.name]);
      else if (r.scope === 'worker') out.push([r.name, `${r.name}@worker:${workerId}`]);
    }
    for (const u of this.rows<{ instance: string }>('SELECT instance FROM worker_instances WHERE worker_id = ? ORDER BY instance', workerId)) {
      for (const s of this.rows<{ resource: string }>(
        `SELECT s.resource FROM instance_serves s JOIN resource_instances i ON i.name = s.instance
          WHERE s.instance = ? AND EXISTS (SELECT 1 FROM json_each(i.repositories) WHERE value = ?) ORDER BY s.resource`, u.instance, repo)) {
        out.push([s.resource, u.instance]);
      }
    }
    return out;
  }

  /** Whether `source` (an instance_readings row's) is a permitted source for the asking worker
   *  (R-BTN-176): administrators and instrument keys always; a runner's reading only when every
   *  resource the instance serves is registered `atoms_from: any` — or when it is the asking
   *  worker's own `runner`-scope instance, which steers only advice that runner receives. */
  private permittedSource(source: string, instance: string, workerId: number): boolean {
    if (source === 'admin' || source.startsWith('probe:')) return true;
    const m = /^worker:(\d+)$/.exec(source);
    if (!m) return false;
    const own = WORKER_INSTANCE.exec(instance);
    if (own && Number(own[2]) === workerId) return true;
    return !this.rows(`SELECT 1 FROM instance_serves s JOIN external_resources e ON e.name = s.resource
        WHERE s.instance = ? AND e.atoms_from != 'any'`, instance).length;
  }

  /** One instance's route-choice reading, from permitted sources only (R-BTN-176): the
   *  administrator's while one is in force, else the most recently observed in force — the
   *  `state` kind for the route-choice state, either kind for the field reading, which is the
   *  latest in force carrying a `detail`. Answers null detail when none carries one. */
  routeReadingFor(workerId: number, instance: string, now: number): { state: InstanceState; detail: unknown } {
    const rows = this.rows<{ source: string; kind: string; available: number | null; detail: string | null }>(
      `SELECT source, kind, available, detail FROM instance_readings WHERE instance = ? AND lapses_at > ? ORDER BY observed_at DESC`, instance, now);
    const inForce = rows.filter((r) => this.permittedSource(r.source, instance, workerId));
    const state = inForce.find((r) => r.source === 'admin' && r.kind === 'state') ?? inForce.find((r) => r.kind === 'state');
    const field = inForce.find((r) => r.source === 'admin' && r.detail != null) ?? inForce.find((r) => r.detail != null);
    return {
      state: !state ? 'unknown' : state.available ? 'available' : 'unavailable',
      detail: field?.detail != null ? JSON.parse(field.detail) : null,
    };
  }

  /** Every resource's stored `x-baton-base` chain (R-BTN-176): one row per base, for `refines`. */
  refinesFacts(): [string, string][] {
    const out: [string, string][] = [];
    for (const r of this.rows<{ name: string; base_chain_json: string }>('SELECT name, base_chain_json FROM external_resources')) {
      for (const base of JSON.parse(r.base_chain_json) as string[]) out.push([r.name, base]);
    }
    return out;
  }
}
