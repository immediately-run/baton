// cloudflare.ts — the integration harness's Cloudflare host (BATON_SPEC §13a S-BTN-31): the
// Runner and its Durable Object in workerd, through @cloudflare/vitest-plugin.
import { env, reset as resetStorage, runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import type { Baton } from '../../src/cloudflare/baton';
import type { BatonCore } from '../../src/core/baton';
import type { Config } from '../../src/core/ports';
import { RECOMMENDED_CLIENT } from '../../src/core/http';

export const HOST = 'cloudflare';
export const config: Config = env;

/** The fixed object. */
export function stub() {
  return env.BATON.get(env.BATON.idFromName('baton'));
}

/** B-254 (R-BTN-197): the client version the harness's own requests name — the recommended one,
 *  so the suite runs inside the served window. S-BTN-227 sends its own values through `raw`. */
export function withClient(req: Request): Request {
  if (req.headers.has('Baton-Client')) return req;
  const headers = new Headers(req.headers);
  headers.set('Baton-Client', `baton/${RECOMMENDED_CLIENT}`);
  return new Request(req, { headers });
}

/** A request to the Worker, as the harness's client. */
export function call(req: Request): Promise<Response> {
  return (exports as unknown as { default: { fetch: (r: Request) => Promise<Response> } }).default.fetch(withClient(req));
}

/** A request to the Worker exactly as built — S-BTN-227's old and versionless clients, and a
 *  runner's own `Baton-Client`, reach Baton as they are. */
export function raw(req: Request): Promise<Response> {
  return (exports as unknown as { default: { fetch: (r: Request) => Promise<Response> } }).default.fetch(req);
}

/** Run `fn` with the object's core, inside the object. */
export function withCore<T>(fn: (core: BatonCore) => T | Promise<T>): Promise<T> {
  return runInDurableObject(stub(), (o: Baton) => fn(o.core));
}

/** One alarm tick, run directly. Not `runDurableObjectAlarm`: the fake clock sits behind the
 * real one, so every alarm the object arms is already overdue and workerd may be running it in
 * the background — when it is, nothing is scheduled and `runDurableObjectAlarm` runs nothing. */
export function tick(): Promise<void> {
  return withCore((c) => c.alarm());
}

/** Every test starts from an empty Baton. */
export function reset(): Promise<void> {
  return resetStorage();
}
