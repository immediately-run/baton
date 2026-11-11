// resources.ts — external resources, their instances and the instruments' readings (BATON_SPEC §6.3
// R-BTN-76, R-BTN-101; R3-1251; B-168). Per Baton, not per repository: an administrator registers a
// resource (its scope — `account` or `service` — and its readings' `detail` schema) and each
// account instance (what it serves, which repositories' runners may use it). A repository's usable
// instances of a resource are the `service` instance and the account instances that serve it and
// list the repository — the same for every runner granted there. Runners, probes and
// administrators post readings, each kept per instrument and each lapsing on its own; an
// administrator's reading is one more instrument's, with no precedence. An instance's state — the
// most recently observed `state` reading in force, else `unknown` — is evaluated here, stored, and
// each change is a `resource` event that the blocks recount from. Core reads the envelope, never
// `detail`, and no name here means anything.
import { BatonError } from './http';
import { logEvent } from './db';
import { baseChainOf, detailProblem, sameSchema, schemaProblem, type Schema } from './detailSchema';
import { refinementGaps } from '../shared/schema.mjs';
import { stdSchema } from '../shared/std.mjs';
import { checkCapacity, checkInstance, checkReadings, checkResource, VALID_FOR } from './validate';
import type { Blocks } from './blocks';
import type { Deprecated } from './deprecated';
import type { Store } from './ports';

/** R-BTN-76: at most one reading per runner, instance and kind a minute. */
export const WORKER_READING_EVERY_MS = 60_000;

export interface Ctx {
  store: Store;
  now: () => number;
  blocks: Blocks;
  /** The retired-fields window's one writer (`deprecated.ts`): a reading's `nonce`, `signature`. */
  deprecated?: Deprecated;
}

/** Who posts a reading: a runner session, a probe key, or an administrator — one more instrument. */
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

  /** `PUT /v1/admin/capacities` (R-BTN-178, §6.11): `{capability, capacity}` — an integer 1–64,
   *  or null to clear the capability's capacity, giving it unlimited seats again. A lower
   *  capacity never takes back a held seat; it applies to the next claim or advance. Seats write
   *  no block and wake no one (R-BTN-72): a freed seat sends no `unblocked`. */
  setCapacity(actor: string, body: unknown) {
    const b = checkCapacity(body);
    return this.c.store.transaction(() => {
      const now = this.c.now();
      if (b.capacity == null) {
        this.exec('DELETE FROM capability_capacity WHERE capability = ?', b.capability);
        logEvent(this.c.store, now, 'admin', actor, { act: 'capacity-cleared', capability: b.capability }, null, null, null);
      } else {
        this.exec(`INSERT INTO capability_capacity (capability, capacity, set_by, set_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT (capability) DO UPDATE SET capacity = excluded.capacity, set_by = excluded.set_by, set_at = excluded.set_at`,
          b.capability, b.capacity, actor, now);
        logEvent(this.c.store, now, 'admin', actor, { act: 'capacity-set', capability: b.capability, capacity: b.capacity }, null, null, null);
      }
      return { ok: true };
    });
  }

  /** `GET /v1/admin/capacities[?capability=<c>]` (R-BTN-178): every capacity, and, for one named
   *  capability, every course of the tenant whose legs require it with the type's definition in
   *  each — what `baton admin capacity set` prints before it asks to confirm, the administrator's
   *  statement being that the name denotes the same thing in every repository (R-BTN-137). */
  capacities(capability?: string) {
    const capacities = this.rows<{ capability: string; capacity: number; set_by: string; set_at: number }>(
      'SELECT capability, capacity, set_by, set_at FROM capability_capacity ORDER BY capability');
    if (capability === undefined) return { capacities };
    const courses = this.rows<{ repository_id: string; id: string; version: number; course_json: string; leg_capabilities_json: string }>(
      'SELECT repository_id, id, version, course_json, leg_capabilities_json FROM courses ORDER BY repository_id, id')
      .flatMap((c) => {
        let legs: Record<string, string[]> = {};
        let types: Record<string, unknown> = {};
        try {
          legs = JSON.parse(c.leg_capabilities_json) as Record<string, string[]>;
          types = ((JSON.parse(c.course_json) as { capability_types?: unknown }).capability_types ?? {}) as Record<string, unknown>;
        } catch { /* a course file the registry accepted never fails this */ }
        return Object.entries(legs).some(([, needs]) => (needs ?? []).includes(capability))
          ? [{
            repository: c.repository_id, course: c.id, version: c.version,
            legs: Object.entries(legs).filter(([, needs]) => (needs ?? []).includes(capability)).map(([leg]) => leg).sort(),
            type: this.typeOf(types, capability),
          }]
          : [];
      });
    return { capacities, requiring: courses };
  }

  /** The named capability's type as the course file declared it, for the confirm print. */
  private typeOf(types: Record<string, unknown>, capability: string): { description: string; values: string } | null {
    const t = types[capability.slice(0, capability.indexOf(':'))];
    return t && typeof t === 'object' && typeof (t as { description?: unknown }).description === 'string' && typeof (t as { values?: unknown }).values === 'string'
      ? { description: (t as { description: string }).description, values: (t as { values: string }).values }
      : null;
  }

  /** `POST /v1/admin/resources`: `{name, scope, detail_schema}`, `scope` `account` or `service`
   *  (R-BTN-76: what a runner uses is its repository's, never one it declares). The schema is
   *  refused outside R-BTN-76's subset; an `x-baton-base` names a `std:` schema (and only one —
   *  R-BTN-176), and a refinement R-BTN-108's check cannot prove is refused, its chain stored for
   *  `refines` atoms. A `service` resource is its own one instance. Registering a name again is
   *  idempotent only with the same scope and schema: instances and readings were judged by them. */
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
      const known = this.rows<{ scope: string; detail_schema: string }>('SELECT scope, detail_schema FROM external_resources WHERE name = ?', r.name)[0];
      if (known) {
        if (known.scope !== r.scope || !sameSchema(JSON.parse(known.detail_schema), r.detail_schema as Schema)) {
          throw new BatonError('conflict', `${r.name} is registered with another scope or schema`);
        }
        return { ok: true };
      }
      if (this.rows('SELECT 1 FROM resource_instances WHERE name = ?', r.name).length) throw new BatonError('conflict', `${r.name} is already an instance's name`);
      this.exec('INSERT INTO external_resources (name, scope, detail_schema, base_chain_json) VALUES (?, ?, ?, ?)', r.name, r.scope, JSON.stringify(r.detail_schema), JSON.stringify(chain));
      if (r.scope === 'service') {
        this.exec(`INSERT INTO resource_instances (name, repositories) VALUES (?, '[]')`, r.name);
        this.exec('INSERT INTO instance_serves (instance, resource) VALUES (?, ?)', r.name, r.name);
        this.exec(`INSERT INTO instance_states (instance, state, changed_at) VALUES (?, 'unknown', ?) ON CONFLICT (instance) DO NOTHING`, r.name, now);
      }
      logEvent(this.c.store, now, 'admin', actor, { act: 'resource-added', name: r.name, scope: r.scope, ...(chain.length ? { refines: chain } : {}) }, null, null, null);
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

  // ── readings (R-BTN-76, R-BTN-101) ────────────────────────────────────────────────────────

  /** The resources an instance serves, with their schemas — none when it is no registered
   *  instance. */
  private servedBy(instance: string): { resource: string; scope: string; schema: Schema }[] {
    return this.rows<{ resource: string; scope: string; detail_schema: string }>(
      `SELECT s.resource, e.scope, e.detail_schema FROM instance_serves s JOIN external_resources e ON e.name = s.resource WHERE s.instance = ? ORDER BY s.resource`, instance)
      .map((r) => ({ resource: r.resource, scope: r.scope, schema: JSON.parse(r.detail_schema) }));
  }

  /** Whether `who` may report on `instance` (R-BTN-76): an administrator and a probe on any
   *  registered instance; a runner on any account instance that lists a repository its key works
   *  on (`repos` null: a key with no grants, which reaches all). */
  private mayReport(who: Instrument, instance: string, served: { scope: string }[], repos: string[] | null): 'ok' | 'forbidden' {
    if (who.kind !== 'worker') return 'ok';
    if (!served.every((s) => s.scope === 'account')) return 'forbidden';
    const listed = JSON.parse(this.rows<{ repositories: string }>('SELECT repositories FROM resource_instances WHERE name = ?', instance)[0]?.repositories ?? '[]') as string[];
    return repos === null || listed.some((r) => repos.includes(r)) ? 'ok' : 'forbidden';
  }

  /**
   * `POST /v1/runner/readings`, `/v1/probe/readings` and `/v1/admin/readings`: each reading checked
   * on its own — the envelope, the instance registered, who may report on it, `detail` against its
   * resources' schema — and stored as this instrument's latest of its kind; a refused one is
   * answered with its code, never the post. An administrator's reading is one more instrument's
   * (R-BTN-76): held to the same limits, stored beside the others and ordered with them, its
   * writer class `admin` — no precedence. A reading's `nonce` and `signature` are its retired
   * signature (R-BTN-181), read and ignored while the history's Migrations entry lasts.
   */
  // @model reading sha256:7c747d85a0b4
  post(who: Instrument, body: unknown, repos: string[] | null) {
    const readings = checkReadings(body, VALID_FOR.state_s);
    return this.c.store.transaction(() => {
      const now = this.c.now();
      const refused: { instance: string; code: string; message?: string }[] = [];
      const touched = new Set<string>();
      // An administrator's instrument is its key; a probe's, its key; a runner's, its session.
      const source = who.kind === 'admin' ? `admin:${who.fingerprint}` : who.kind === 'probe' ? `probe:${who.fingerprint}` : `worker:${who.workerId}`;
      const writer = who.kind === 'admin' ? 'admin' : who.kind === 'probe' ? 'instrument' : 'runner';
      for (const field of new Set(readings.flatMap((r) => r.retired))) this.c.deprecated?.note(now, source, `reading.${field}`, 'readings');
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
        // R-BTN-181: the writer class the credential names; a reading carries no signature, the
        // request that posts it being its authentication.
        this.exec(`INSERT INTO instance_readings (instance, source, kind, available, until, observed_at, lapses_at, detail, posted_by, writer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (instance, source, kind) DO UPDATE SET available = excluded.available, until = excluded.until, observed_at = excluded.observed_at,
                     lapses_at = excluded.lapses_at, detail = excluded.detail, posted_by = excluded.posted_by, writer = excluded.writer`,
          r.instance, source, r.kind, r.kind === 'state' ? (r.available ? 1 : 0) : null, r.until, now, lapses, detail, source, writer);
        if (r.kind === 'state') touched.add(r.instance);
      }
      this.refresh(touched);
      return { ok: true, refused };
    });
  }

  /** `POST /v1/admin/readings {instance, clear: {source?}}` (R-BTN-76, R-BTN-151): every reading
   *  in force on the instance from one instrument (the `source` a reading carries: `admin:<fp>`,
   *  `probe:<fp>`, `worker:<id>`), or from all when none is named; logged, and the state follows. */
  clear(actor: string, body: unknown) {
    if (!isObj(body) || typeof body.instance !== 'string' || !isObj(body.clear)) throw new BatonError('invalid-params', 'body: must be {instance, clear}');
    const instance = body.instance as string;
    const raw = body.clear.source;
    if (raw !== undefined && (typeof raw !== 'string' || raw.length > 200)) throw new BatonError('invalid-params', 'clear.source: must be the source a reading carries');
    const source = raw as string | undefined;
    return this.c.store.transaction(() => {
      this.exec(`DELETE FROM instance_readings WHERE instance = ?${source !== undefined ? ' AND source = ?' : ''}`, ...(source !== undefined ? [instance, source] : [instance]));
      this.refresh([instance]);
      logEvent(this.c.store, this.c.now(), 'admin', actor, { act: 'readings-cleared', instance, ...(source !== undefined ? { source } : {}) }, null, null, null);
      return { ok: true };
    });
  }

  /** R-BTN-76: the most recently observed `state` reading in force, else `unknown` — an
   *  administrator's one instrument's among the rest. */
  stateOf(instance: string, now = this.c.now()): { state: InstanceState; until: number | null } {
    const r = this.rows<{ available: number; until: number | null }>(
      `SELECT available, until FROM instance_readings WHERE instance = ? AND kind = 'state' AND lapses_at > ?
       ORDER BY observed_at DESC, rowid DESC LIMIT 1`, instance, now)[0];
    if (!r) return { state: 'unknown', until: null };
    return r.available ? { state: 'available', until: null } : { state: 'unavailable', until: r.until };
  }

  /** Re-evaluate these instances' states (every instance with a reading or a stored state when
   *  none is named): each change is stored and logged as a `resource` event, then all are
   *  recounted at once. */
  refresh(instances?: Iterable<string>) {
    const now = this.c.now();
    const names = instances ? [...instances] : this.rows<{ instance: string }>('SELECT instance FROM instance_states UNION SELECT instance FROM instance_readings').map((r) => r.instance);
    const changed: string[] = [];
    for (const name of names) {
      const s = this.stateOf(name, now);
      const stored = this.rows<{ state: InstanceState; until: number | null }>('SELECT state, until FROM instance_states WHERE instance = ?', name)[0];
      if (stored?.state === s.state && stored.until === s.until) continue;
      if (!stored && s.state === 'unknown') continue;
      this.exec(`INSERT INTO instance_states (instance, state, until, changed_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT (instance) DO UPDATE SET state = excluded.state, until = excluded.until,
                   changed_at = CASE WHEN instance_states.state = excluded.state THEN instance_states.changed_at ELSE excluded.changed_at END`,
        name, s.state, s.until, now);
      if (stored?.state !== s.state) logEvent(this.c.store, now, 'resource', 'baton', { instance: name, state: s.state, ...(s.until != null ? { until: s.until } : {}), ...(stored ? { was: stored.state } : {}) }, null, null, null);
      changed.push(name);
    }
    this.c.blocks.instancesChanged(changed);
  }

  /** The alarm's share: lapsed readings are dropped (every reading in force is kept, R-BTN-101),
   *  and the states they held change. Returns when the next one lapses. */
  // @model readingLapses sha256:5a1fa56a409d
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

  /** The repository's usable instances of each resource (R-BTN-76, B-168): every `service`
   *  instance — its own — and each account instance that serves the resource and lists the
   *  repository, one set for every runner granted there. */
  usableFor(repo: string): [string, string][] {
    const out: [string, string][] = [];
    for (const r of this.rows<{ name: string; scope: string }>('SELECT name, scope FROM external_resources ORDER BY name')) {
      if (r.scope === 'service') out.push([r.name, r.name]);
      else {
        for (const s of this.rows<{ instance: string }>(
          `SELECT s.instance FROM instance_serves s JOIN resource_instances i ON i.name = s.instance
            WHERE s.resource = ? AND EXISTS (SELECT 1 FROM json_each(i.repositories) WHERE value = ?) ORDER BY s.instance`, r.name, repo)) {
          out.push([r.name, s.instance]);
        }
      }
    }
    return out;
  }

  /** One instance's reading as the route choices' inputs form it (R-BTN-176): the `state`
   *  kind's latest in force for the state, either kind's latest in force that carries a `detail`
   *  for the field reading — an administrator's one instrument's among them (B-168). Answers null
   *  detail when none carries one. */
  readingFor(instance: string, now: number): { state: InstanceState; detail: unknown } {
    const r = this.rows<{ detail: string }>(
      `SELECT detail FROM instance_readings WHERE instance = ? AND lapses_at > ? AND detail IS NOT NULL
       ORDER BY observed_at DESC, rowid DESC LIMIT 1`, instance, now)[0];
    return { state: this.stateOf(instance, now).state, detail: r ? (JSON.parse(r.detail) as unknown) : null };
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
