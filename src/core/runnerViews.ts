// R-BTN-99: the machine-key views separate reach from the data they serve.
import { groupBy } from './db';
import { BatonError, json } from './http';
import { sha256HexSync } from './policy';
import type { Store } from './ports';
import { repositoryOf } from './registry';
import type { Resources } from './resources';
import { ifNoneMatch, schedulingVersion } from './stateVersion';
import { REPORT_HORIZON_MS } from './validate';

export const opaque = (value: string | null | undefined): unknown => value == null ? null : JSON.parse(value);
export type ViewScope = { key: string; repositories: string[]; grants: unknown };

type View = 'fleet' | 'instances' | 'launch-candidates';
const HOUR = 3_600_000;

/** Test the validator before building the view. The clock edges cover reads before the alarm. */
export function runnerViewResponse(store: Store, now: number, req: Request, scope: ViewScope,
  view: View, repository: string | null, read: () => unknown): Response {
  const repos = JSON.stringify(repository ? [repository] : scope.repositories);
  const heads = view === 'instances' ? [] : store.exec(`SELECT repository_id, fleet_version FROM board_head
    WHERE repository_id IN (SELECT value FROM json_each(?)) ORDER BY repository_id`, repos).toArray();
  const instances = view === 'fleet' ? [] : store.exec("SELECT value FROM baton_settings WHERE key = 'instances_version'").toArray();
  const clock = view === 'fleet' ? store.exec(`SELECT
    (SELECT max(received_at) FROM runner_reports WHERE repository_id = ? AND received_at <= ?) AS expired_report,
    (SELECT count(*) FROM owner_bars WHERE repository_id = ? AND lifted_at IS NULL AND starts_at <= ?) AS started,
    (SELECT count(*) FROM owner_bars WHERE repository_id = ? AND lifted_at IS NULL AND ends_at <= ?) AS ended`,
    repository, now - REPORT_HORIZON_MS, repository, now, repository, now).one()
    : view === 'instances' ? store.exec('SELECT max(lapses_at) AS expired FROM instance_readings WHERE lapses_at <= ?', now).one()
    : [schedulingVersion(store), store.exec(`SELECT count(*) AS backing_off FROM ready_tickets WHERE retry_after > ?
      AND repository_id IN (SELECT value FROM json_each(?))`, now, repos).one()];
  const etag = `"${sha256HexSync(JSON.stringify([view, repository, scope, Math.floor(now / HOUR), heads, instances, clock]))}"`;
  if (ifNoneMatch(req, etag)) return new Response(null, { status: 304, headers: { ETag: etag } });
  const response = json(read());
  response.headers.set('ETag', etag);
  return response;
}

export function instanceView(store: Store, resources: Pick<Resources, 'view' | 'readings'>, now: number, scope: ViewScope) {
  const granted = new Set(scope.repositories);
  const { resources: types, instances } = resources.view(now, scope.repositories);
  const readings = groupBy(resources.readings(now, true), 'instance');
  const holders = groupBy(store.exec<{ capability: string; ticket_id: string; hostname: string; leg: string | null; claimed_at: number; fence_pending: number }>(`
    SELECT s.capability, c.ticket_id, w.hostname, coalesce(c.leg, c.offered_leg) AS leg, c.claimed_at, c.fence_pending
      FROM claim_seats s JOIN claims c ON c.id = s.claim_id JOIN runners w ON w.id = c.runner_id
      WHERE c.status = 'active' OR (c.status = 'reaped' AND c.fence_pending = 1) ORDER BY c.id`).toArray(), 'capability');
  const capabilities = store.exec<{ capability: string; capacity: number }>('SELECT capability, capacity FROM capability_capacity ORDER BY capability').toArray()
    .map((cap) => ({ ...cap, holders: (holders.get(cap.capability) ?? []).map(({ ticket_id, hostname, leg, claimed_at, fence_pending }) => {
      const repository = repositoryOf(ticket_id);
      return { repository, leg, claimed_at, fence_pending: !!fence_pending, ...(granted.has(repository) ? { ticket_id, hostname } : {}) };
    }) }));
  const services = new Set(types.filter((r) => r.scope === 'service').map((r) => r.name));
  return { instances: instances.filter((i) => i.serves.some((s) => services.has(s)) || i.repositories.some((r) => granted.has(r)))
    .map((i) => ({ ...i, readings: (readings.get(i.name) ?? []).map(({ stale: _stale, ...reading }) => reading) })), capabilities };
}

export function fleetSummary(store: Store, repo: string, queues: { course: string; leg: string; depth: number; max_queue: number | null }[]) {
  const stations = store.exec(`SELECT t.course_id AS course, s.station, count(*) AS tickets
    FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id WHERE t.repository_id = ?
    GROUP BY t.course_id, s.station ORDER BY t.course_id, s.station`, repo).toArray();
  const counts = store.exec<{ course: string; leg: string; ready: number; waiting: number }>(`SELECT t.course_id AS course, n.leg,
    sum(n.state = 'ready') AS ready, sum(n.state = 'waiting') AS waiting FROM tickets t
    JOIN ticket_next_legs n ON n.ticket_id = t.id WHERE t.repository_id = ? GROUP BY t.course_id, n.leg`, repo).toArray();
  const legs = new Map(queues.map((q) => [JSON.stringify([q.course, q.leg]), { ready: 0, waiting: 0, ...q }]));
  for (const count of counts) {
    const key = JSON.stringify([count.course, count.leg]);
    legs.set(key, { depth: 0, max_queue: null, ...legs.get(key), ...count });
  }
  return { stations, legs: [...legs.values()] };
}

export function requireFleetScope(repo: string, scope: ViewScope) {
  if (!scope.repositories.includes(repo)) throw new BatonError('forbidden', `the key is not granted on ${repo} (R-BTN-58)`);
}
