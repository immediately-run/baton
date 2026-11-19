// db.ts — the small helpers every class that writes the object's tables shares: the event log's
// one insert, the random hex nonces and secrets, recognising a unique-index refusal, and the
// grouping of one read's rows by their parent.
import type { Row, SqlValue, Store } from './ports';
import { repositoryOf } from './validate';

/** Append to the event log (§4): the one place an event row is written. An event about a
 *  ticket belongs to the ticket's repository (its qualified id says which, R-BTN-47); a
 *  repository's own events (a snapshot, a cutover) name it; instance events have none. */
export function logEvent(sql: Store, at: number, kind: string, actor: string, detail: unknown, ticketId: string | null = null, claimId: number | null = null,
  repositoryId: string | null = ticketId ? repositoryOf(ticketId) : null) {
  sql.exec('INSERT INTO events (at, kind, ticket_id, claim_id, actor, detail_json, repository_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    at, kind, ticketId, claimId, actor, JSON.stringify(detail), repositoryId);
}

/** `bytes` random bytes as hex: a claim's 6-hex nonce, a legacy runner's unusable secret hash. */
export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** B-240: rows read for many parents at once, grouped by their parent's `key` and each without
 *  it, in the order the query gave them. */
export function groupBy<T extends Row>(rows: T[], key = 'claim_id'): Map<SqlValue, Row[]> {
  const out = new Map<SqlValue, Row[]>();
  for (const { [key]: k, ...rest } of rows) {
    const list = out.get(k);
    if (list) list.push(rest);
    else out.set(k, [rest]);
  }
  return out;
}

/** The core's random source: `n` random bytes. Tests replace it as they replace the clock
 *  (R-BTN-32's seam; B-185), through `Ports.random`. */
export type Random = (n: number) => Uint8Array;
export const systemRandom: Random = (n) => crypto.getRandomValues(new Uint8Array(n));

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** R-BTN-63 (B-185): a run id — `r_` and a ULID: 26 characters of Crockford base32 encoding 48
 *  bits of `at` (epoch milliseconds) then 80 random bits. Opaque: no reader parses it. */
export function mintRunId(at: number, random: Random = systemRandom): string {
  let time = '';
  let t = Math.max(0, Math.floor(at)) % 2 ** 48;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand = CROCKFORD[Number(bits & 31n)] + rand;
    bits >>= 5n;
  }
  return `r_${time}${rand}`;
}

/** Whether `e` is SQLite refusing a write on a unique index — the lock's refusal (R-BTN-4). */
export function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/.test(String(e));
}
