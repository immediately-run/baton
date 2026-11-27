// reads/tenant.ts — the tenant reads (B-202; BATON_SPEC §11.4, §14): what the administrator's
// tenant screens draw, each answered to an administrator's key and to an administrator's
// session and to no one else (R-BTN-57, R-BTN-155) — an owner's key or session, and a runner's
// key, are `forbidden`.
//
//   admin.repo.list      GET /v1/admin/repositories   the registry (it answered a key before
//                                                     B-202; its rows gain fields, lose none)
//   admin.capacity.list  GET /v1/admin/capacities     R-BTN-178's capacities (likewise)
//   admin.instance.list  GET /v1/admin/instances      R-BTN-76's instances with their readings
//   admin.resource.list  GET /v1/admin/resources      the resources, and the probe keys
//   admin.settings.show  GET /v1/admin/settings       §13.1's instance settings
//   admin.tenant         GET /v1/admin/tenant         R-BTN-87's figures against the envelope
//   admin.session.list   GET /v1/admin/sessions       the live dashboard sessions
//
// NEVER A SECRET (§12.1). A session is listed by its key's fingerprint and its times — never
// its id, the hash the store keeps of it, or its cookie. A key is listed by its fingerprint and
// label — never its line. A repository's `remote` is not served: a URL may carry a credential.
//
// Nothing here is invented (the lead's ruling 2): the request rates are the core's own ring
// (`RequestRing`, R-BTN-87 — in memory, emptied by a restart), the counts the envelope's own
// (`Capacity.counts`), and what no store holds — a session's last use and client address, the
// store's size in bytes, a probe's added time — is left out and named in `not_built`.
import { keysNotice } from '../views';
import { sha256Hex } from '../runnerApi';
import type { ReadCtx, ReadRoute } from './kit';
import type { Row } from '../ports';

/** A reading in force on an instance (R-BTN-76, R-BTN-101), as an instrument posted it. */
export type ReadingRow = {
  /** `admin:<fingerprint>`, `probe:<fingerprint>` or `runner:<id>`: the instrument. */
  source: string;
  /** R-BTN-181's writer class: `admin`, `instrument` or `runner`; null on a row older than it. */
  writer: string | null;
  kind: 'state' | 'measure';
  /** A `state` reading's word; null on a `measure`. */
  available: boolean | null;
  until: number | null;
  observed_at: number;
  lapses_at: number;
  /** The validated detail (R-BTN-76), or null. */
  detail: unknown;
  /** True once `lapses_at` has passed and the alarm has not yet dropped the row. */
  stale: boolean;
};

export type InstanceRow = {
  name: string;
  repositories: string[];
  serves: string[];
  state: 'available' | 'unavailable' | 'unknown';
  until: number | null;
  /** Newest first. */
  readings: ReadingRow[];
};

function parsed(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** `admin.instance.list`: the instance view runners rank from (R-BTN-99), with every reading. */
function instances(cx: ReadCtx): { instances: InstanceRow[]; server_time: number } {
  const now = cx.now();
  const readings = new Map<string, ReadingRow[]>();
  for (const { instance, ...r } of cx.core.resources.readings(now)) {
    const list = readings.get(instance) ?? [];
    list.push(r);
    readings.set(instance, list);
  }
  return {
    instances: cx.core.resources.view(now).instances.map((i) => ({ ...i, readings: readings.get(i.name) ?? [] })),
    server_time: now,
  };
}

/** `admin.resource.list`: each resource with its schema and instances, and the probe keys. */
function resources(cx: ReadCtx) {
  const serves = new Map<string, string[]>();
  for (const s of cx.sql<{ instance: string; resource: string }>('SELECT instance, resource FROM instance_serves ORDER BY resource, instance')) {
    serves.set(s.resource, [...(serves.get(s.resource) ?? []), s.instance]);
  }
  return {
    resources: cx.sql<{ name: string; scope: string; detail_schema: string }>('SELECT name, scope, detail_schema FROM external_resources ORDER BY name')
      .map((r) => ({ name: r.name, scope: r.scope, detail_schema: parsed(r.detail_schema), instances: serves.get(r.name) ?? [] })),
    // R-BTN-101: the instrument keys, by fingerprint and label — never the key's line.
    probes: cx.sql<{ fingerprint: string; label: string | null; allowed_instances: string; created_by: string | null }>(
      `SELECT id AS fingerprint, label, allowed_instances, created_by FROM credentials WHERE kind = 'probe' AND revoked_at IS NULL ORDER BY label, id`)
      .map((p) => ({ fingerprint: p.fingerprint, label: p.label, instances: parsed(p.allowed_instances), added_by: p.created_by })),
  };
}

/** `admin.capacity.list`: `Resources.capacities`' answer, each capacity with the seats held and
 *  the claims holding them (R-BTN-178: one pool across the tenant's repositories). */
function capacities(cx: ReadCtx, capability: string | undefined) {
  const view = cx.core.resources.capacities(capability);
  const holders = new Map<string, { claim_id: number; ticket_id: string; runner_id: number }[]>();
  for (const s of cx.sql<{ capability: string; claim_id: number; ticket_id: string; runner_id: number }>(
    'SELECT s.capability, s.claim_id, c.ticket_id, c.runner_id FROM claim_seats s JOIN claims c ON c.id = s.claim_id ORDER BY s.capability, s.claim_id')) {
    holders.set(s.capability, [...(holders.get(s.capability) ?? []), { claim_id: s.claim_id, ticket_id: s.ticket_id, runner_id: s.runner_id }]);
  }
  return { ...view, capacities: view.capacities.map((c) => ({ ...c, held: (holders.get(c.capability) ?? []).length, holders: holders.get(c.capability) ?? [] })) };
}

/** `admin.repo.list`: `BatonCore.adminView`'s rows — `stateView()`'s repository rows — each
 *  with the registry's `sync_keys`, `ci_identity` and `retired_at`; with `?retired=1`
 *  the retired rows too (R-BTN-47), which have no head and no courses in force. */
function registry(cx: ReadCtx, withRetired: boolean) {
  const keys = new Map<string, { fingerprint: string; role: string }[]>();
  for (const k of cx.sql<{ repository_id: string; fingerprint: string; role: string }>('SELECT repository_id, fingerprint, role FROM sync_keys WHERE revoked_at IS NULL ORDER BY repository_id, role, fingerprint')) {
    keys.set(k.repository_id, [...(keys.get(k.repository_id) ?? []), { fingerprint: k.fingerprint, role: k.role }]);
  }
  const extras = (id: string) => {
    const r = cx.core.registry.get(id);
    return { sync_keys: keys.get(id) ?? [], ci_identity: r?.ci_identity ?? null, retired_at: r?.retired_at ?? null };
  };
  const live = cx.core.adminView().repositories.map((row) => ({ ...row, ...extras(row.id) }));
  const retired = !withRetired ? [] : cx.sql<{ id: string }>('SELECT id FROM repositories WHERE retired_at IS NOT NULL ORDER BY id').flatMap(({ id }) => {
    const r = cx.core.registry.get(id);
    return r ? [{ id: r.id, github: r.github, forge: r.forge, web_base: r.web_base, default_branch: r.default_branch, weight: r.weight, head: null,
      mode: cx.core.runners.mode(r.id), courses: [], ...extras(r.id) }] : [];
  });
  const seed_owners = cx.core.admin.seedOwnedRepositories();
  return { repositories: [...live, ...retired], ...(seed_owners.length ? { seed_owners } : {}) };
}

/** `admin.tenant`: R-BTN-87's figures, each against its envelope value (`Capacity.view`, what
 *  `stateView()` serves as `capacity`), the live claims beside them (no envelope names one),
 *  the day's usage (R-BTN-2), the move's two marks (R-BTN-88), and — under `needs_you` — the
 *  instance-wide listings V1's Needs you drew that belong to no repository (B-203's ledger;
 *  `repo.needs-you` names them under `elsewhere`): the keys notice, the figures over 80% of the
 *  envelope, the instances `unknown` a day while a posted leg needs what they serve
 *  (R-BTN-76), the live runners below the recommended client (R-BTN-197), and the live runners
 *  declaring no course at all (R-BTN-22; the ones below one course's version are that
 *  repository's listing). Each is the list its own module answers `stateView()` with — the
 *  same function, never a second query. */
function instanceOverview(cx: ReadCtx) {
  const figures = cx.core.capacityFigures();
  const now = cx.now();
  return {
    ...cx.core.capacity.view(figures),
    live_claims: cx.sql<{ n: number }>(`SELECT COUNT(*) AS n FROM claims WHERE status = 'active'`)[0]?.n ?? 0,
    frozen_at: cx.core.ownerState.frozenAt(),
    sealed_at: cx.core.ownerState.sealedAt(),
    needs_you: {
      keys: keysNotice(cx.core),
      ...cx.core.capacity.needsYou(figures),
      instances_unknown: cx.core.blocks.needsYou(now).instances_unknown,
      stale_clients: cx.core.runners.staleClients(cx.core.runners.runnersView(now), cx.core.instance.recommendedClient()),
      stale_skills_no_course: (cx.core.claims.needsYou(now).stale_skills as Row[]).filter((r) => r.repository_id == null),
    },
    // What the ticket lists and no store holds: the store's size in bytes.
    not_built: { storage_bytes: 'B-202' },
    server_time: now,
  };
}

/** How many live sessions one answer lists. Sessions live 12 hours (R-BTN-155). */
const SESSIONS_MAX = 500;

/** `admin.session.list`: the live dashboard sessions — unrevoked, unexpired, their key still an
 *  administrator's — newest first, the caller's own marked. A session is named by its key's
 *  fingerprint and its times alone. */
async function sessions(cx: ReadCtx, own: string | null) {
  const now = cx.now();
  const admins = await cx.core.admin.adminFingerprints();
  const mine = own == null ? null : await sha256Hex(own);
  const access = await cx.core.admin.accessFingerprints();
  const live = cx.sql<{ id_hash: string; admin_key: string; access_email_hash: string | null; created_at: number; expires_at: number }>(
    `SELECT id_hash, admin_key, access_email_hash, created_at, expires_at FROM dashboard_sessions
     WHERE revoked_at IS NULL AND expires_at > ?
       AND admin_key IN (SELECT value FROM json_each(?))
       AND (access_email_hash IS NULL OR (access_email_hash, admin_key) IN (SELECT key, value FROM json_each(?)))
     ORDER BY created_at DESC, id_hash LIMIT ?`,
    now, JSON.stringify([...admins.keys()]), JSON.stringify(Object.fromEntries(access)), SESSIONS_MAX);
  return {
    sessions: live.map((s) => ({ role: 'administrator' as const, key_fingerprint: s.admin_key, via: s.access_email_hash === null ? 'link' : 'access', created_at: s.created_at, expires_at: s.expires_at, current: mine != null && s.id_hash === mine })),
    // What the ticket lists and no store holds: a session's last use and its client's address.
    not_built: { last_seen_at: 'B-76', client_addr: 'B-76' },
    server_time: now,
  };
}

export const INSTANCE_READS: ReadRoute[] = [
  // The registry rows carry each repository's mode and queues: the clock's.
  { action: 'admin.repo.list', clock: true, run: (cx, call) => registry(cx, call.url.searchParams.get('retired') === '1') },
  { action: 'admin.capacity.list', run: (cx, call) => capacities(cx, call.url.searchParams.get('capability') ?? undefined) },
  // An instance's state and a reading's `stale` are the clock's.
  { action: 'admin.instance.list', clock: true, run: (cx) => instances(cx) },
  { action: 'admin.resource.list', run: (cx) => resources(cx) },
  { action: 'admin.settings.show', run: (cx) => cx.core.instance.view() },
  // The rates are the object's own measurement, which moves no state version: never conditional.
  { action: 'admin.tenant', etag: false, run: instanceOverview },
  // `current` is the calling session's own, and two sessions of one key share a caller key:
  // never conditional.
  { action: 'admin.session.list', etag: false, run: (cx, call) => sessions(cx, call.principal.kind === 'session' ? call.req.headers.get('X-Baton-Session') : null) },
];
