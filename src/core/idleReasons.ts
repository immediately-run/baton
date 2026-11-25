import type { Store } from './ports';

/** B-244 refusal detail: one first exclusion per queued ready leg; samples are deterministic. */
export interface IdleGate {
  gate: string;
  count: number;
  tickets: string[];
  capabilities?: string[];
  readings?: { resource: string; instance: string; writer: string; until: number | null }[];
}

export interface IdleDetail {
  repositories: { repository: string; gates: IdleGate[] }[];
}

/** Only temporarily held work calls for an owner notification, not work outside a tier cap. */
const heldGates = new Set(['attempts-exhausted', 'held', 'unconfirmed-end', 'blocked', 'backing-off', 'awaiting-sync', 'resource']);

export function noteIdle(store: Store, runner: number, now: number, threshold: number, detail: IdleDetail | undefined,
  notify: (repository: string) => boolean): void {
  const episode = store.exec<{ started_at: number; notified_repositories: string }>(`SELECT started_at, notified_repositories FROM runner_idle WHERE runner_id = ?`, runner).toArray()[0];
  if (store.exec(`SELECT 1 FROM claims WHERE runner_id = ? AND status = 'active' LIMIT 1`, runner).toArray().length) return;
  const since = episode?.started_at ?? now;
  if (!episode) store.exec(`INSERT INTO runner_idle (runner_id, started_at) VALUES (?, ?)`, runner, since);
  if (now - since < threshold || !detail) return;
  const notified = new Set<string>(episode ? JSON.parse(episode.notified_repositories) as string[] : []);
  const before = notified.size;
  for (const { repository, gates } of detail.repositories) {
    if (!notified.has(repository) && gates.some(({ gate }) => heldGates.has(gate)) && notify(repository)) notified.add(repository);
  }
  if (notified.size !== before) store.exec(`UPDATE runner_idle SET notified_repositories = ? WHERE runner_id = ?`, JSON.stringify([...notified]), runner);
}
