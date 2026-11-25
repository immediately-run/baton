import { describe, expect, it } from 'vitest';
import { claimFleetSql, expiredLeaseSql, isClaimLeaseLive, isLive, liveDeclaringRunnerSql, liveRunnerSql } from '../../src/core/runnerLiveness';
import { rows } from '../helpers';

describe('B-283: runner liveness agrees in TypeScript and SQLite', () => {
  // S-BTN-2/3/4: live at the last millisecond, expired at the declared deadline.
  // S-BTN-16/285: an imported claim uses its own timer, and the runner roster isn't a claim gate.
  it.each([
    { name: 'just before expiry', now: 900_999, reaped: null, revoked: null, kind: 'vm', live: true, claim: true, fleet: true, declaring: true, expired: false },
    { name: 'at expiry', now: 901_000, reaped: null, revoked: null, kind: 'vm', live: false, claim: false, fleet: false, declaring: false, expired: true },
    { name: 'after expiry', now: 901_001, reaped: null, revoked: null, kind: 'vm', live: false, claim: false, fleet: false, declaring: false, expired: true },
    { name: 'already reaped', now: 900_999, reaped: 900_000, revoked: null, kind: 'vm', live: false, claim: true, fleet: false, declaring: false, expired: false },
    { name: 'credential revoked', now: 900_999, reaped: null, revoked: 900_000, kind: 'vm', live: true, claim: true, fleet: false, declaring: true, expired: false },
    { name: 'legacy with a lease in range', now: 900_999, reaped: null, revoked: null, kind: 'legacy', live: true, claim: false, fleet: false, declaring: false, expired: false },
  ])('$name', async ({ now, reaped, revoked, kind, live, claim, fleet, declaring, expired }) => {
    const runner = { last_seen_at: 1_000, lease_timeout_ms: 900_000, reaped_at: reaped, kind };
    expect(isLive(runner, now)).toBe(live);
    expect(isClaimLeaseLive(runner, now)).toBe(claim);
    expect(await rows(
      `WITH w(last_seen_at, lease_timeout_ms, reaped_at, kind) AS (VALUES (?, ?, ?, ?)),
            c(revoked_at) AS (VALUES (?))
       SELECT ${liveRunnerSql('w.')} AS live, ${claimFleetSql()} AS fleet,
              ${liveDeclaringRunnerSql} AS declaring, ${expiredLeaseSql} AS expired FROM w CROSS JOIN c`,
      runner.last_seen_at, runner.lease_timeout_ms, reaped, kind, revoked, now, now, now, now,
    )).toEqual([{ live: +live, fleet: +fleet, declaring: +declaring, expired: +expired }]);
  });
});
