// host.ts — Baton as a local Node process (BATON_SPEC §3a R-BTN-55): the core over `node:sqlite`,
// every request and alarm tick through one queue, a timer as the alarm, and the same front as
// the Worker. For development and CI, using the same core as the Worker.
import { BatonCore } from '../core/baton';
import { front } from '../core/front';
import { dispatchWorkflow } from '../core/mirror';
import type { AccessIdentities, AdminKeys, Config, Scheduler, Store } from '../core/ports';
import { RequestQueue } from './queue';
import { acceptTenant, boundTenant, foreignHost, forTenant, servesHost, TENANT_ID } from '../shell/tenant';

export interface LocalOptions {
  store: Store;
  config: Config;
  adminKeys?: AdminKeys;
  accessIdentities?: AccessIdentities;
  /** R3-1236's local `workerd` runner; until it lands, tests inject a fake. */
  /** `timer` fires the alarm by the clock; `manual` only records it (a test ticks it). */
  alarm?: 'timer' | 'manual';
}

/** The alarm as a timer (§3): one pending fire at the instant the core last set, run through
 *  the queue like a request. */
class TimerScheduler implements Scheduler {
  private at: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly clock: () => number, private readonly fire: (() => void) | null) {}
  async get() {
    return this.at;
  }
  async set(at: number) {
    this.at = at;
    if (!this.fire) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.at = null;
      this.timer = null;
      this.fire!();
    }, Math.max(0, at - this.clock()));
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export class LocalHost {
  readonly core: BatonCore;
  readonly queue = new RequestQueue();
  private readonly scheduler: TimerScheduler;
  private readonly deferred = new Set<Promise<unknown>>();

  constructor(private readonly opts: LocalOptions) {
    const fire = opts.alarm === 'manual' ? null : () => {
      this.tick().catch((e) => console.error('baton: alarm failed', e));
    };
    this.scheduler = new TimerScheduler(() => this.core.now(), fire);
    this.core = new BatonCore({
      store: opts.store,
      scheduler: this.scheduler,
      config: opts.config,
      dispatch: {
        send: (target) => dispatchWorkflow(opts.config.GITHUB_DISPATCH_TOKEN, target),
        defer: (work) => {
          const p = work.catch(() => {}).finally(() => this.deferred.delete(p));
          this.deferred.add(p);
        },
      },
      adminKeys: opts.adminKeys ?? { list: () => [] },
      accessIdentities: opts.accessIdentities,
      gate: { outside: (work) => this.queue.outside(work) },
    });
  }

  /** Migrations and the first alarm, before any request (§3). */
  start(): Promise<void> {
    return this.queue.run(() => this.core.start());
  }

  /** A request from outside, answered as the Worker answers it. */
  async handle(req: Request): Promise<Response> {
    if (!servesHost(req, this.opts.config.BATON_ORIGIN)) return foreignHost();
    return front(req, this.opts.config, (r) => this.queue.run(async () => {
      const forwarded = forTenant(r, TENANT_ID);
      const admission = acceptTenant(this.opts.store, forwarded, TENANT_ID);
      if (admission instanceof Response) return admission;
      if (admission === 'new' && await this.scheduler.get() === null) await this.scheduler.set(this.core.now());
      return this.core.fetch(forwarded);
    }),
      async () => (await this.core.admin.adminFingerprints()).size > 0);
  }

  /** One alarm tick now, in its turn. */
  tick(): Promise<void> {
    return this.queue.run(async () => {
      if (boundTenant(this.opts.store) === TENANT_ID) await this.core.alarm();
    });
  }

  /** Stop the alarm and let started dispatches finish. */
  async stop(): Promise<void> {
    this.scheduler.stop();
    await Promise.all([...this.deferred]);
  }
}
