// stats-size.test.ts — the course record at a realistic size (R3-1248, review gate round 2,
// 2-r2-0): 8,000 claims over 2,000 tickets, each with two legs, read in one call in well under a
// second on the local store — the per-ticket history is one ordered pass, not a scan per claim.
// Node only: it opens node:sqlite.
import { describe, it, expect } from 'vitest';
import { openStore } from '../../src/local/store';
import { MIGRATIONS } from '../../src/migrations';
import { Stats } from '../../src/core/stats';

describe('the course record at size', () => {
  it('8,000 claims read in under a second', () => {
    const { store } = openStore(':memory:');
    for (const m of MIGRATIONS) store.script(m.sql);
    store.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities) VALUES ('c', 'h', '[]')`);
    store.exec(`INSERT INTO workers (id, credential_id, hostname, session_name, harness, kind, secret_hash, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES (1, 'c', 'h', 's', 'claude-code', 'vm', 'x', 'critical', 900000, 'x', 0, 0)`);
    const T0 = Date.parse('2026-10-01T00:00:00Z');
    store.transaction(() => {
      for (let i = 0; i < 8000; i++) {
        const t = `docs:T-${i % 2000}`;
        const at = T0 + i * 60_000;
        store.exec(`INSERT INTO claims (id, ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason, station, course_id, offered_ready_since)
                    VALUES (?, ?, 1, ?, 'abcdef', '', ?, 'released', ?, 'released:requested', 'pr-open', 'roadmap-pr', ?)`, i + 1, t, `r${i}`, at, at + 30_000, at - 60_000);
        store.exec(`INSERT INTO claim_legs (claim_id, seq, leg, from_station, to_station, started_at, started_observation, finished_at) VALUES (?, 1, 'implement', 'filed', 'pr-open', ?, 0, ?)`, i + 1, at + 1_000, at + 10_000);
        store.exec(`INSERT INTO claim_legs (claim_id, seq, leg, from_station, started_at, started_observation, abandoned_at) VALUES (?, 2, 'review', 'pr-open', ?, 0, ?)`, i + 1, at + 11_000, at + 30_000);
      }
    });
    const start = performance.now();
    const r = new Stats(store).of('docs', T0, T0 + 8000 * 60_000);
    const ms = performance.now() - start;
    expect(r.courses['roadmap-pr'].legs.implement.started).toBe(8000);
    expect(r.courses['roadmap-pr'].legs.review.waited).toEqual({ count: 8000, median_s: 1, max_s: 1 });
    expect(r.courses['roadmap-pr'].stations['pr-open'].waited.count).toBe(6000);
    expect(ms).toBeLessThan(1000);
  });
});
