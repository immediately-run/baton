// deprecated.ts — the one writer of the `deprecated-field` events B-166's "part 4's retired
// fields" window (BATON_SPEC_HISTORY, Migrations) and R-BTN-132's board-post window log: a field
// the code no longer reads, accepted and ignored so a CLI or `.baton/baton.json` older than the
// change keeps syncing and claiming. One row per field, actor and day is kept, so a heartbeat
// every minute costs one row a day; the event is logged when that row is written. The core holds
// the `logged` set — nothing is module state — so a beat that logged its day once does not log it
// again, and a fresh process logs the day's first again (the row's insert changes nothing).
import { logEvent } from './db';
import { BatonError } from './http';
import type { Store } from './ports';

export const DAY_MS = 86_400_000;
export const DROP_TIERS_MIGRATION = 77;
const TIER_FIELDS = ['ticket.tier', 'heartbeat.tier_ceiling', 'heartbeat.tier_ceilings', 'grant.max_tier', 'repository.tiers', 'tickets.tier'];

/** The one Deprecated: the store, and the days this process has logged (`field\0actor\0day`). */
export class Deprecated {
  private readonly logged: Set<string> = new Set();

  constructor(private readonly store: Store) {}

  /** Start at migration, then close permanently after 30 days without legacy traffic.
   * Keep the last sighting even when today's event has already been emitted. */
  tierFields(now: number, actor: string, fields: string[], what: string, repository: string | null = null) {
    if (!fields.length) return;
    this.store.transaction(() => {
      const last = this.store.exec<{ seen: number }>(`SELECT MAX(seen) AS seen FROM (
        SELECT applied_at AS seen FROM _baton_migrations WHERE id = ?
        UNION ALL SELECT seen_at FROM deprecated_fields WHERE field IN (${TIER_FIELDS.map(() => '?').join(', ')}))`,
      DROP_TIERS_MIGRATION, ...TIER_FIELDS).toArray()[0].seen;
      if (now - last >= 30 * DAY_MS) throw new BatonError('invalid-params', `${fields[0]} is no longer accepted`);
      const day = Math.floor(now / DAY_MS);
      for (const field of fields) {
        const inserted = this.store.exec(`INSERT INTO deprecated_fields (field, actor, day, seen_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (field, actor, day) DO NOTHING RETURNING field`, field, actor, day, now).toArray().length;
        if (inserted) logEvent(this.store, now, 'deprecated-field', actor, { field, what }, null, null, repository);
        else this.store.exec('UPDATE deprecated_fields SET seen_at = MAX(seen_at, ?) WHERE field = ? AND actor = ? AND day = ?', now, field, actor, day);
      }
    });
  }

  /** Log that `actor` posted `field` (its wire name, `<owner>.<field>` for a nested one) and that
   *  Baton read it as absent. `what` names where — a heartbeat, a board post, the route — for the
   *  event's detail. */
  note(now: number, actor: string, field: string, what: string, repository: string | null = null) {
    const day = Math.floor(now / DAY_MS);
    const key = `${field}\u0000${actor}\u0000${day}`;
    if (this.logged.has(key)) return;
    this.logged.add(key);
    this.store.exec(`INSERT INTO deprecated_fields (field, actor, day, seen_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT (field, actor, day) DO NOTHING`, field, actor, day, now);
    logEvent(this.store, now, 'deprecated-field', actor, { field, what }, null, null, repository);
  }
}
