import { randomBytes } from 'node:crypto';
import { LEG_PROCESS, type Executor } from './executor';
import { msg } from './log';

export const HOST_PLACEMENT_END = 'released:host-placement';

/** Called only at the host executor's start boundary, never on leg or source output. */
export function isPlacementFailure(error: unknown): boolean {
  if (typeof error === 'object' && error != null && 'code' in error && error.code === 'HOST_PLACEMENT') return true;
  const message = msg(error);
  return /\b(?:failed to place (?:the |a )?sandbox|sandbox placement (?:failed|unavailable)|cannot map [\d,.]+\s*[kmgt]i?b of guest memory|memory pool is too small|(?:out of|insufficient) (?:guest |host )?memory)\b/i.test(message)
    || ((/\b5\d\d\b/.test(message) || (typeof error === 'object' && error != null && 'status' in error && typeof error.status === 'number' && error.status >= 500 && error.status < 600))
      && /\bplacement (?:error|failed|failure|refused|unavailable)\b/i.test(message));
}

const FIRST_PROBE_MS = 5_000;
const MAX_PROBE_MS = 120_000;

export class Placement {
  private outage: { next: number; delay: number } | null = null;
  private generation = 0;

  constructor(
    private readonly executor: Pick<Executor, 'placementHealth' | 'start' | 'stop'>,
    private readonly now: () => number,
    private readonly log: (line: string) => void,
  ) {}

  get paused(): boolean { return this.outage !== null; }
  get nextProbe(): number { return this.outage?.next ?? Infinity; }

  unavailable(reason: string): void {
    this.generation++;
    if (this.outage) return;
    this.outage = { next: this.now() + FIRST_PROBE_MS, delay: FIRST_PROBE_MS };
    this.log(`baton: ${reason}; not taking claims until executor placement recovers`);
  }

  async canClaim(checkout: string): Promise<boolean> {
    const outage = this.outage;
    if (outage && this.now() < outage.next) return false;
    const generation = this.generation;
    try {
      if (this.executor.placementHealth) {
        const health = await this.executor.placementHealth();
        if (health.ready !== true || health.freeSlots === 0) {
          this.unavailable('the executor reports no placement capacity');
          return false;
        }
      } else if (outage) {
        // Older pinned executors know source sessions. Place and stop one without running code
        // or sending a leg environment, channel or forge proof.
        const handle = await this.executor.start({ brief: {
          kind: 'source', session_id: `source-probe-${randomBytes(6).toString('hex')}`,
          checkout, paths: [], wrapper: LEG_PROCESS, env: {},
        } });
        await this.executor.stop(handle, 'placement-probe');
      }
      if (this.generation !== generation) return false;
      if (outage) {
        this.outage = null;
        this.log('baton: executor placement recovered; taking claims again');
      }
      return true;
    } catch {
      this.unavailable('the executor placement check failed');
      return false;
    } finally {
      if (outage && this.outage === outage) {
        outage.delay = Math.min(outage.delay * 2, MAX_PROBE_MS);
        outage.next = this.now() + outage.delay;
      }
    }
  }
}
