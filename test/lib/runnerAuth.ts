import { RunnerApi, type Ctx } from '../../src/core/runnerApi';

/** A RunnerApi for tests of credentials and request nonces, not heartbeat or claim effects. */
export function runnerAuth(c: Pick<Ctx, 'store' | 'config' | 'now'>): RunnerApi {
  const unexpected = (): never => { throw new Error('runner effects are outside this auth fixture'); };
  return new RunnerApi({ ...c,
    fenced: unexpected, legFinished: unexpected, claimView: unexpected, bars: unexpected,
    couriers: unexpected, policies: { recordProtection: unexpected }, fleetChanged: unexpected,
    held: unexpected, deprecated: { note: unexpected, tierFields: unexpected }, sessionHosts: unexpected,
  });
}
