// sequences.ts — the per-repository, per-kind sequences (BATON_SPEC §4.3 R-BTN-195, B-176):
// every identifier a concurrent branch writes to git — a ticket id from any filer, a rule,
// scenario or gate id, a migration number — is one Baton hands out, so two branches open at once
// can never take the same number. The observation counter (R-BTN-62) is the precedent: one
// number per repository serialized concurrent sync runs; this is one number per repository and
// kind, serialized the same way, inside one transaction.
//
// The number is `max(stored, floor) + 1`: the caller's `floor` is the highest number it sees in
// git — the default branch and every open branch's head — so a lost or fresh Baton never issues a
// number git already holds (value 1: lost state fails closed). A number a branch holds only
// locally, not yet pushed, is the one a floor cannot see; the duplicate check at merge stays the
// backstop for it. `floor` is caller-supplied and could be inflated to burn numbers: a floor more
// than FLOOR_CAP above the stored number is refused, and gaps are harmless.
import { BatonError } from './http';
import { logEvent } from './db';
import type { Store } from './ports';

/** The most a `floor` may be above the stored number: gaps are harmless, and a floor that large
 *  only burns numbers (B-176's Trust). */
export const FLOOR_CAP = 10_000;

interface Row { last_number: number }

export class Sequences {
  constructor(private readonly c: { store: Store; now: () => number }) {}

  /** `POST /v1/repositories/{repository}/sequences/{kind}/next` (R-BTN-195): the next number of
   *  the repository's `kind` sequence — `max(stored, floor) + 1`, the row written and one
   *  `sequence` event logged, naming the caller and, when given, the ticket it is for. Core
   *  knows no kind's meaning (value 3): `kind` reached here already matches SEQUENCE_KIND. */
  next(repo: string, kind: string, floor: number | null, actor: string, forTicket: string | null): { kind: string; number: number } {
    return this.c.store.transaction(() => {
      const stored = this.c.store.exec<Row>('SELECT last_number FROM sequences WHERE repository_id = ? AND kind = ?', repo, kind).toArray()[0]?.last_number ?? 0;
      const f = floor ?? 0;
      if (f > stored + FLOOR_CAP) {
        throw new BatonError('invalid-params', `floor: more than ${FLOOR_CAP} above the stored number (${stored}) is refused — gaps are harmless, and a floor that large only burns numbers (R-BTN-195)`);
      }
      const n = Math.max(stored, f) + 1;
      this.c.store.exec(
        'INSERT INTO sequences (repository_id, kind, last_number) VALUES (?, ?, ?) ON CONFLICT (repository_id, kind) DO UPDATE SET last_number = excluded.last_number',
        repo, kind, n);
      logEvent(this.c.store, this.c.now(), 'sequence', actor, { kind, number: n, ...(floor != null ? { floor: f } : {}) },
        forTicket != null ? `${repo}:${forTicket}` : null, null, repo);
      return { kind, number: n };
    });
  }
}
