// S-BTN-6: attribute correlated retryable ends to a runner key.
import type { Store } from './ports';
import type { Conditions } from './conditions';
import { HOUR, MAX_FAULT_WINDOW_S } from './attempts';

const FIRST_DELAY = 5 * 60_000;
const DEFAULT_RUNNER_FAULTS = { tickets: 3, window_s: 900 };
const RUNNER_FAULT = 'baton.runner-faulting';
const FLEET_FAULT = 'baton.fleet-faulting';

interface Sample {
  claim_id: number;
  ticket_id: string;
  reason: string;
  error_type: string | null;
  undo_json: string | null;
}

interface Ending {
  claim: number;
  ticket: string;
  credential: string;
  repository: string;
  reason: string;
  errorType: string | null;
}

function summarize(samples: Sample[]) {
  const counts = new Map<string, { end_reason: string; error_type: string | null; count: number }>();
  for (const { reason, error_type } of samples) {
    const key = `${reason}:${error_type ?? ''}`;
    const row = counts.get(key);
    if (row) row.count++;
    else counts.set(key, { end_reason: reason, error_type, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.end_reason.localeCompare(b.end_reason)
    || (a.error_type ?? '').localeCompare(b.error_type ?? ''));
}

export class RunnerFaults {
  constructor(private store: Store, private now: () => number, private conditions: Pick<Conditions, 'notifyCore' | 'closeCore'>) {}

  until(runner: number): number | null {
    return this.store.exec<{ until_at: number }>(`SELECT until_at FROM runner_fault_backoff
      WHERE credential_id = (SELECT credential_id FROM runners WHERE id = ?) AND until_at > ?`,
    runner, this.now()).toArray()[0]?.until_at ?? null;
  }

  private policy(repository: string): typeof DEFAULT_RUNNER_FAULTS {
    const setting = this.store.exec<{ runner_faults: string | null }>('SELECT runner_faults FROM repositories WHERE id = ?', repository).toArray()[0]?.runner_faults;
    return setting ? JSON.parse(setting) as typeof DEFAULT_RUNNER_FAULTS : DEFAULT_RUNNER_FAULTS;
  }

  /** Returns true if this end is already attributed. Earlier charges unwind newest first. */
  record(e: Ending, undo: (sample: Sample, burst: number) => void): boolean {
    const { claim, ticket, credential, repository, reason, errorType } = e;
    const now = this.now();
    const policy = this.policy(repository);
    const since = now - policy.window_s * 1000;
    const sql = this.store;
    sql.exec('DELETE FROM runner_fault_samples WHERE burst IS NULL AND ended_at < ?', now - MAX_FAULT_WINDOW_S * 1000);
    sql.exec(`INSERT INTO runner_fault_samples (claim_id, repository_id, credential_id, ticket_id, ended_at, reason, error_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, claim, repository, credential, ticket, now, reason, errorType);
    const pending = sql.exec<Sample>(`SELECT s.claim_id, s.ticket_id, s.reason, s.error_type, s.undo_json FROM runner_fault_samples s
      WHERE s.repository_id = ? AND s.credential_id = ? AND s.burst IS NULL AND s.ended_at >= ?
      ORDER BY s.ended_at, (SELECT MAX(e.seq) FROM events e WHERE e.claim_id = s.claim_id AND e.kind = 'released')`, repository, credential, since).toArray();
    const episode = sql.exec<{ burst: number; started_at: number }>(`SELECT burst, started_at FROM runner_fault_episodes
      WHERE repository_id = ? AND credential_id = ?`, repository, credential).toArray()[0];
    const backoff = sql.exec<{ until_at: number; delay_ms: number }>('SELECT until_at, delay_ms FROM runner_fault_backoff WHERE credential_id = ?', credential).toArray()[0];
    const continuing = episode && episode.started_at >= since && backoff && backoff.until_at > now;
    if (!continuing && new Set(pending.map((s) => s.ticket_id)).size < policy.tickets) return false;

    const burst = continuing ? episode.burst : claim;
    const until = continuing ? backoff.until_at : now + Math.min(HOUR, backoff ? backoff.delay_ms * 2 : FIRST_DELAY);
    if (!continuing) {
      sql.exec('DELETE FROM runner_fault_samples WHERE repository_id = ? AND credential_id = ? AND burst IS NOT NULL', repository, credential);
      sql.exec(`INSERT INTO runner_fault_backoff VALUES (?, ?, ?) ON CONFLICT (credential_id)
        DO UPDATE SET until_at = excluded.until_at, delay_ms = excluded.delay_ms`, credential, until, until - now);
      sql.exec(`INSERT INTO runner_fault_episodes VALUES (?, ?, ?, ?) ON CONFLICT (repository_id, credential_id)
        DO UPDATE SET burst = excluded.burst, started_at = excluded.started_at`, repository, credential, burst, now);
    }
    for (const sample of pending.reverse()) {
      undo(sample, burst);
      sql.exec('UPDATE runner_fault_samples SET burst = ?, undo_json = NULL WHERE claim_id = ?', burst, sample.claim_id);
    }
    const reasons = summarize(this.samples(repository, [burst]));
    this.conditions.notifyCore(repository, RUNNER_FAULT, credential, { runner: credential, burst, until, reasons });
    this.fleet(repository);
    return true;
  }

  remember(claim: number, undo: object) {
    this.store.exec('UPDATE runner_fault_samples SET undo_json = ? WHERE claim_id = ?', JSON.stringify(undo), claim);
  }

  outcome(credential: string) {
    const sql = this.store;
    sql.exec('DELETE FROM runner_fault_backoff WHERE credential_id = ?', credential);
    sql.exec('DELETE FROM runner_fault_samples WHERE credential_id = ?', credential);
    const episodes = sql.exec<{ repository_id: string }>('DELETE FROM runner_fault_episodes WHERE credential_id = ? RETURNING repository_id', credential).toArray();
    for (const { repository_id: repo } of episodes) {
      this.conditions.closeCore(repo, RUNNER_FAULT, credential);
      this.fleet(repo);
    }
  }

  private samples(repository: string, bursts: number[]) {
    return this.store.exec<Sample>(`SELECT claim_id, ticket_id, reason, error_type, undo_json FROM runner_fault_samples
      WHERE repository_id = ? AND burst IN (SELECT value FROM json_each(?))`, repository, JSON.stringify(bursts)).toArray();
  }

  private fleet(repository: string) {
    const episodes = this.store.exec<{ burst: number; started_at: number }>(`SELECT burst, started_at FROM runner_fault_episodes
      WHERE repository_id = ? ORDER BY started_at DESC`, repository).toArray();
    const since = (episodes[0]?.started_at ?? 0) - this.policy(repository).window_s * 1000;
    const bursts = episodes.filter((e) => e.started_at >= since).map((e) => e.burst);
    if (bursts.length < 2) this.conditions.closeCore(repository, FLEET_FAULT, null);
    else this.conditions.notifyCore(repository, FLEET_FAULT, null, { runners: bursts.length, reasons: summarize(this.samples(repository, bursts)) });
  }
}
