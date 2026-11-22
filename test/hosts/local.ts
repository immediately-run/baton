// local.ts — the integration harness's local host (BATON_SPEC §13a S-BTN-31): the same core on
// `node:sqlite` behind the request queue, in this Node process, with the run's test bindings
// (vitest.config.ts provides them; a local start refuses them).
import { inject } from 'vitest';
import type { BatonCore } from '../../src/core/baton';
import type { Config } from '../../src/core/ports';
import { RECOMMENDED_CLIENT } from '../../src/core/http';
import { LocalHost } from '../../src/local/host';
import { openStore } from '../../src/local/store';
export const HOST = 'local';
export const config: Config = inject('localConfig');

async function fresh(): Promise<LocalHost> {
  const h = new LocalHost({ store: openStore(':memory:').store, config, alarm: 'manual' });
  await h.start();
  return h;
}

let host = await fresh();

/** The host under test, for tests that drive it directly. */
export const current = () => host;

/** B-254 (R-BTN-197): the client version the harness's own requests name — the recommended one,
 *  so the suite runs inside the served window. S-BTN-227 sends its own values through `raw`. */
export function withClient(req: Request): Request {
  if (req.headers.has('Baton-Client')) return req;
  const headers = new Headers(req.headers);
  headers.set('Baton-Client', `baton/${RECOMMENDED_CLIENT}`);
  return new Request(req, { headers });
}

/** A request to the local front, as the harness's client: `withClient` names the recommended
 *  client version (B-254, R-BTN-197), so the suite's own requests run inside the served
 *  window. */
export async function call(req: Request): Promise<Response> {
  return raw(withClient(req));
}

/** A request to the local front exactly as built — S-BTN-227's old and versionless clients, and
 *  a runner's own `Baton-Client`, reach Baton as they are. */
export function raw(req: Request): Promise<Response> {
  return host.handle(req);
}

/** Run `fn` with the core, in its turn in the queue. */
export function withCore<T>(fn: (core: BatonCore) => T | Promise<T>): Promise<T> {
  return host.queue.run(() => fn(host.core));
}

/** One alarm tick, in its turn. */
export function tick(): Promise<void> {
  return host.tick();
}

/** Every test starts from an empty Baton: a new in-memory database. */
export async function reset(): Promise<void> {
  await host.stop();
  host = await fresh();
}
