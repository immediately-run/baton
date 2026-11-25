// Server-side liveness only: the sidecar's earlier, local fence is R-BTN-6's last_ok rule.
export type Lease = { last_seen_at: number; lease_timeout_ms: number };
type Runner = Lease & { reaped_at: number | null };
type ClaimRunner = Lease & { kind: string; api_lease_cap_at?: number | null };

export function leaseEndsAt(runner: Lease): number {
  return runner.last_seen_at + runner.lease_timeout_ms;
}

/** R-BTN-3/9: runner liveness, including the dashboard's runner roster and timeline.
 *  A revoked credential does not rewrite the runner's last-seen or reap time. */
export function isLive(runner: Runner, now: number): boolean {
  return runner.reaped_at == null && now < leaseEndsAt(runner);
}

/** R-BTN-19: the recorded lease when reaping an active claim, also shown on the dashboard's
 *  claim views. The active claim's runner row supplies the lease, not the roster's reap flag;
 *  imported claims have a separate reap_after, not a heartbeat lease (R-BTN-28). */
export function isClaimLeaseLive(runner: ClaimRunner, now: number): boolean {
  return runner.kind !== 'legacy' && now < claimLeaseEndsAt(runner);
}

export function claimLeaseEndsAt(claim: ClaimRunner): number {
  return claim.api_lease_cap_at ?? leaseEndsAt(claim);
}

// Keep the lease sum identical to the expression in the partial runners_live index (0061).
// Only fixed query aliases/placeholders go here; the clock value is always bound separately.
type Prefix = '' | 'w.';
const leaseEndSql = (prefix: Prefix) => `${prefix}last_seen_at + ${prefix}lease_timeout_ms`;

export function liveRunnerSql(prefix: Prefix = '', now: '?' | ':now' = '?'): string {
  return `${prefix}reaped_at IS NULL AND ${leaseEndSql(prefix)} > ${now}`;
}

/** R-BTN-75/77: a live runner counted for the claim gates must be able to claim: no imported
 *  placeholders and no revoked keys (R-BTN-28/58). The caller joins credentials as c. */
export function claimFleetSql(now: '?' | ':now' = '?'): string {
  return `${liveRunnerSql('w.', now)} AND w.kind != 'legacy' AND c.revoked_at IS NULL`;
}

/** R-BTN-22: stale skills apply only to live runners that can declare a course. */
export const liveDeclaringRunnerSql = `${liveRunnerSql('w.')} AND w.kind != 'legacy'`;

/** R-BTN-87: the existing capacity-envelope count is unreaped non-legacy rows, not a lease read. */
export const unreapedCapacityRunnerSql = `reaped_at IS NULL AND kind != 'legacy'`;

/** R-BTN-19: the alarm expires the heartbeat lease at equality, even if the runner has
 *  already been marked reaped. Callers handle the imported claim's timer separately. */
export const expiredLeaseSql = `${leaseEndSql('w.')} <= ?`;

export const expiredClaimLeaseSql = `COALESCE(c.api_lease_cap_at, ${leaseEndSql('w.')}) <= ?`;
