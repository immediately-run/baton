import { nonScheduling } from './stateVersion';
import type { Store } from './ports';

const LATE_MS = 30 * 60_000;
export const HAS_MIRROR = `(r.mirror_workflow IS NOT NULL OR json_extract(r.ci_identity, '$.mirror') = 1 OR EXISTS (
  SELECT 1 FROM sync_keys k WHERE k.repository_id = r.id AND k.role = 'mirror' AND k.revoked_at IS NULL))`;

// R-BTN-36: claims and ticket overrides are the events the legacy mirror writes to git.
const MIRRORED = `e.kind IN ('claimed', 'completed', 'released', 'suspended', 'reaped', 'foreign-claim', 'adopted', 'fence-cleared')
  OR (e.kind = 'override' AND (json_type(e.detail_json, '$.hold') IS NOT NULL OR json_type(e.detail_json, '$.expedite') IS NOT NULL))`;

export class SyncWants {
  constructor(private readonly c: { store: Store; now: () => number }) {}

  /** R-BTN-94: keep the first time but advance the fence for every request, including one
   * arriving after a run took its number. Called in the transaction that causes the want. */
  request(repository: string) {
    nonScheduling(this.c.store, () => this.c.store.exec(`UPDATE repositories SET sync_wanted_at = COALESCE(sync_wanted_at, ?),
      sync_wanted_after = COALESCE((SELECT last_handed_out FROM board_head WHERE repository_id = repositories.id), 0)
      WHERE id = ? AND retired_at IS NULL
        AND (sync_wanted_at IS NULL OR sync_wanted_after IS NOT COALESCE((SELECT last_handed_out FROM board_head WHERE repository_id = repositories.id), 0))`, this.c.now(), repository));
  }

  /** A posted reading (including a legacy held post), in the transaction accepting its number. */
  posted(repository: string, observation: number, sha: string) {
    nonScheduling(this.c.store, () => {
      this.c.store.exec(`UPDATE board_head SET posted_sha = ? WHERE repository_id = ? AND posted_sha IS NOT ?`, sha, repository, sha);
      this.c.store.exec(`UPDATE repositories SET sync_wanted_at = NULL, sync_wanted_after = NULL
      WHERE id = ? AND sync_wanted_after < ?`, repository, observation);
    });
  }

  wanted(repository: string, role: 'sync' | 'mirror') {
    const r = this.c.store.exec<{ wanted_at: number | null; head_sha: string | null }>(
      `SELECT r.sync_wanted_at AS wanted_at, COALESCE(b.posted_sha, b.sha) AS head_sha
       FROM repositories r LEFT JOIN board_head b ON b.repository_id = r.id WHERE r.id = ?`, repository).one();
    const since = role === 'mirror' ? this.mirrorBacklog(repository)[0]?.wanted_at : r.wanted_at;
    return { wanted: since != null, ...(since == null ? {} : { since }), head_sha: r.head_sha };
  }

  mirrorBacklog(repository?: string) {
    const mirrors = this.c.store.exec<{ id: string; mirror_acked_seq: number }>(`SELECT r.id, r.mirror_acked_seq FROM repositories r
      WHERE r.retired_at IS NULL AND ${HAS_MIRROR} ${repository === undefined ? '' : 'AND r.id = ?'} ORDER BY r.id`,
      ...(repository === undefined ? [] : [repository])).toArray();
    const frozen = this.c.store.exec(`SELECT 1 FROM baton_settings WHERE key = 'frozen_at' AND value IS NOT NULL`).toArray().length > 0;
    return mirrors.flatMap(({ id, mirror_acked_seq }) => (frozen
      ? this.c.store.exec<{ wanted_at: number }>(`SELECT at AS wanted_at FROM events WHERE seq > ? ORDER BY seq LIMIT 1`, mirror_acked_seq)
      : this.c.store.exec<{ wanted_at: number }>(
      `SELECT e.at AS wanted_at FROM events e INDEXED BY events_mirror_pending WHERE e.repository_id = ? AND e.seq > ?
        AND (${MIRRORED}) ORDER BY e.seq LIMIT 1`, id, mirror_acked_seq)).toArray().map((row) => ({ repository_id: id, ...row })));
  }

  needsYou(now: number, repository?: string) {
    const late = this.c.store.exec<{ repository_id: string; wanted_at: number }>(`SELECT id AS repository_id, sync_wanted_at AS wanted_at
      FROM repositories WHERE retired_at IS NULL AND sync_wanted_at < ? ${repository === undefined ? '' : 'AND id = ?'} ORDER BY id`,
      now - LATE_MS, ...(repository === undefined ? [] : [repository])).toArray();
    return {
      sync_late: late.map((r) => ({ ...r, kind: 'baton.sync-late' })),
      mirror_late: this.mirrorBacklog(repository).filter((r) => r.wanted_at < now - LATE_MS).map((r) => ({ ...r, kind: 'baton.mirror-late' })),
    };
  }
}
