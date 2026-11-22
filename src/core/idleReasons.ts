import type { Store } from './ports';

/** B-244 refusal detail: one first exclusion per queued ready leg; samples are deterministic. */
export interface IdleGate {
  gate: string;
  count: number;
  tickets: string[];
  limit?: string;
  capabilities?: string[];
  readings?: { resource: string; instance: string; writer: string; until: number | null }[];
}

export interface IdleDetail {
  repositories: { repository: string; gates: IdleGate[] }[];
}

/** Only temporarily held work calls for an owner notification, not work outside a tier cap. */
const heldGates = new Set(['attempts-exhausted', 'held', 'unconfirmed-end', 'blocked', 'backing-off', 'awaiting-sync', 'resource']);

export function noteIdle(store: Store, runner: number, now: number, threshold: number, detail: IdleDetail | undefined,
  notify: (repository: string, entry: unknown) => boolean): void {
  const episode = store.exec<{ started_at: number; notified: number }>(`SELECT started_at, notified FROM runner_idle WHERE runner_id = ?`, runner).toArray()[0];
  if (episode?.notified) return;
  if (store.exec(`SELECT 1 FROM claims WHERE runner_id = ? AND status = 'active' LIMIT 1`, runner).toArray().length) return;
  const since = episode?.started_at ?? now;
  if (!episode) store.exec(`INSERT INTO runner_idle (runner_id, started_at) VALUES (?, ?)`, runner, since);
  if (now - since < threshold || !detail) return;
  let notified = false;
  for (const { repository, gates } of detail.repositories) {
    if (gates.some(({ gate }) => heldGates.has(gate))) {
      notified = notify(repository, { kind: 'runner-idle', runner_id: runner, idle_since: since, gates }) || notified;
    }
  }
  if (notified) store.exec(`UPDATE runner_idle SET notified = 1 WHERE runner_id = ?`, runner);
}
