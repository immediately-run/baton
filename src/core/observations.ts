// observations.ts — the per-repository counter that orders what each sync saw (BATON_SPEC
// R-BTN-62). `POST /v1/sync/observation` hands out the next number before the sync reads anything;
// its board post carries the number back, and is accepted or refused whole. A number is used
// once — posted or refused — and at most one is outstanding per repository at a time, so two
// overlapping sync runs can never post an older reading under a higher number.
import { BatonError } from './http';
import { nonScheduling } from './stateVersion';
import type { Store } from './ports';

/** An outstanding number older than this is void (R-BTN-62). */
export const OBSERVATION_TTL_MS = 10 * 60_000;
export const SYNC_HOURLY_LIMIT = 60;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface HeadRow { sha: string | null; observation: number; last_handed_out: number; handed_out_at: number | null; observation_issuer: string | null }

export class Observations {
  constructor(private readonly c: { store: Store; now: () => number }) {}

  private row(repo: string): HeadRow {
    const r = this.c.store.exec<HeadRow>('SELECT sha, observation, last_handed_out, handed_out_at, observation_issuer FROM board_head WHERE repository_id = ?', repo).toArray()[0];
    if (!r) throw new BatonError('forbidden', `${repo} has no board`);
    return r;
  }

  /** `POST /v1/sync/observation`: the head and the next number — refused `sync-busy` while the
   *  last one is outstanding and under 10 minutes old; an older one is voided by handing out the
   *  next. `bars` are the owner bars in force (R-BTN-67): none until Baton keeps owner bars. */
  // @model syncNumber sha256:348d4417ddb3
  // @model syncVoid sha256:da91945040f2
  observe(repo: string, issuer: string | null = null): { sha: string | null; observation: number; bars: unknown[] } {
    return this.c.store.transaction(() => {
      const now = this.c.now();
      const h = this.row(repo);
      if (h.handed_out_at != null && now - h.handed_out_at < OBSERVATION_TTL_MS) {
        throw new BatonError('sync-busy', `observation ${h.last_handed_out} is still outstanding; one reading at a time per repository (R-BTN-62)`);
      }
      if (issuer !== null) this.charge(issuer, 'observation');
      this.expire(repo, h, now);
      const n = h.last_handed_out + 1;
      nonScheduling(this.c.store, () => this.c.store.exec('UPDATE board_head SET last_handed_out = ?, handed_out_at = ?, observation_issuer = ? WHERE repository_id = ?', n, now, issuer, repo));
      return { sha: h.sha, observation: n, bars: [] };
    });
  }

  /** Use the number a board post carries, whatever becomes of the post: it must be the
   *  outstanding one, under 10 minutes old, and above the last accepted reading's — else the
   *  post is refused `stale-observation`. Committed before the post is judged, so a number is
   *  used once even when the post is then refused (head-moved, held, invalid). */
  // @model syncPost sha256:231806fa206f
  // @model syncVoid sha256:da91945040f2
  use(repo: string, n: number, issuer: string | null = null): void {
    const verdict = this.c.store.transaction(() => {
      const now = this.c.now();
      const h = this.row(repo);
      const outstanding = h.handed_out_at != null && n === h.last_handed_out && h.observation_issuer === issuer;
      if (n <= h.observation) return `observation ${n} is not above the last accepted reading's (${h.observation})`;
      if (!outstanding) return `observation ${n} is not outstanding for this credential`;
      if (this.expire(repo, h, now)) return `observation ${n} was handed out over 10 minutes ago and is void`;
      this.clear(repo);
      return null;
    });
    if (verdict) throw new BatonError('stale-observation', `${verdict}; take a new number and retry (R-BTN-62)`);
  }

  /** A refused post's number, used without judging it: it is no longer outstanding. */
  release(repo: string, n: number, issuer: string | null = null): void {
    this.c.store.transaction(() => {
      const h = this.row(repo);
      if (h.last_handed_out !== n || h.observation_issuer !== issuer || h.handed_out_at === null) return;
      if (!this.expire(repo, h, this.c.now())) this.clear(repo);
    });
  }

  /** Whether a refused post from this issuer might carry the outstanding number. */
  heldBy(repo: string, issuer: string): boolean {
    const h = this.row(repo);
    return h.handed_out_at !== null && h.observation_issuer === issuer;
  }

  /** Debit a request before interpreting it, including posts that are ultimately refused. */
  charge(issuer: string, kind: 'observation' | 'board'): void {
    const hour = Math.floor(this.c.now() / HOUR_MS);
    const used = this.c.store.exec<{ used: number }>(`INSERT INTO sync_quota (issuer, kind, hour, used) VALUES (?, ?, ?, 1)
      ON CONFLICT (issuer, kind) DO UPDATE SET hour = excluded.hour,
        used = CASE WHEN sync_quota.hour = excluded.hour THEN sync_quota.used + 1 ELSE 1 END
      WHERE sync_quota.hour != excluded.hour OR sync_quota.used < ? RETURNING used`, issuer, kind, hour, SYNC_HOURLY_LIMIT).toArray();
    if (!used.length) throw new BatonError('rate-limited', `${kind} quota exhausted for this sync credential (R-BTN-187)`, { retry_at: (hour + 1) * HOUR_MS });
  }

  private clear(repo: string) {
    nonScheduling(this.c.store, () => this.c.store.exec('UPDATE board_head SET handed_out_at = NULL, observation_issuer = NULL WHERE repository_id = ?', repo));
  }

  private expire(repo: string, h: HeadRow, now: number): boolean {
    if (h.handed_out_at == null || now - h.handed_out_at < OBSERVATION_TTL_MS) return false;
    this.clear(repo);
    if (h.observation_issuer !== null) {
      const at = h.handed_out_at + OBSERVATION_TTL_MS;
      nonScheduling(this.c.store, () => this.c.store.exec(`INSERT INTO sync_lapses (repository_id, issuer, day, lapses, at)
        VALUES (?, ?, ?, 1, ?) ON CONFLICT (repository_id, issuer) DO UPDATE SET day = excluded.day, at = excluded.at,
          lapses = CASE WHEN sync_lapses.day = excluded.day THEN sync_lapses.lapses + 1 ELSE 1 END`,
      repo, h.observation_issuer, Math.floor(at / DAY_MS), at));
    }
    return true;
  }

  alarm(): void {
    const now = this.c.now();
    for (const h of this.c.store.exec<HeadRow & { repository_id: string }>('SELECT * FROM board_head WHERE handed_out_at <= ?', now - OBSERVATION_TTL_MS).toArray()) {
      this.expire(h.repository_id, h, now);
    }
    this.c.store.exec('DELETE FROM sync_quota WHERE hour < ?', Math.floor(now / HOUR_MS));
    nonScheduling(this.c.store, () => this.c.store.exec('DELETE FROM sync_lapses WHERE day < ?', Math.floor(now / DAY_MS)));
  }

  needsYou(now: number, repo?: string) {
    return this.c.store.exec<{ repository_id: string; issuer: string; lapses: number; at: number }>(`SELECT repository_id, issuer, lapses, at FROM sync_lapses
      WHERE day = ? AND lapses >= 2 AND (? IS NULL OR repository_id = ?) ORDER BY at DESC, repository_id, issuer`, Math.floor(now / DAY_MS), repo ?? null, repo ?? null).toArray();
  }

  /** Whether `n` is still above the last accepted reading's: re-checked in a post's writing
   *  transaction, after its awaits. */
  newest(repo: string, n: number): boolean {
    return this.row(repo).observation < n;
  }

  /** Record an accepted reading's number (the post's own transaction). */
  accept(repo: string, n: number): void {
    const prior = this.row(repo).observation;
    // Only a crossing of an ended claim's observation can change the freshness gate. Check
    // all ends, including tickets currently held/blocked: those may be reoffered in this sync.
    const changed = this.c.store.exec(`SELECT 1 FROM claims INDEXED BY claims_end_observation WHERE end_observation >= ? AND end_observation < ?
      AND ticket_id >= ? || ':' AND ticket_id < ? || ';' LIMIT 1`, prior, n, repo, repo).toArray().length > 0;
    const write = () => this.c.store.exec('UPDATE board_head SET observation = ? WHERE repository_id = ? AND observation < ?', n, repo, n);
    if (changed) write(); else nonScheduling(this.c.store, write);
  }
}
