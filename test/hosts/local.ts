/// <reference path="../provided.d.ts" />
// local.ts — the integration harness's local host (BATON_SPEC §13a S-BTN-31): the same core on
// `node:sqlite` behind the request queue, in this Node process, with the run's test bindings
// (vitest.config.ts provides them; a local start refuses them).
import { inject } from 'vitest';
import type { BatonCore } from '../../src/core/baton';
import type { Config, Store } from '../../src/core/ports';
import type { AssertHost } from './contract';
import { RECOMMENDED_CLIENT } from '../../src/core/http';
import { LocalHost } from '../../src/local/host';
import { openStore } from '../../src/local/store';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { beginTrace, recordingStore, takeSteps, toItf, type Origin } from '../integration/trace';

type _Host = AssertHost<typeof import('./local')>;

export const HOST = 'local';
export const config: Config = inject('localConfig');

/** The request or alarm tick whose code is running, for the trace's steps. */
const origins = new AsyncLocalStorage<Origin>();

async function fresh(trace = true) {
  let h: LocalHost | null = null;
  const { db, store: sqlite } = openStore(':memory:');
  const store = trace ? recordingStore(sqlite, () => origins.getStore() ?? null, () => h?.core.now() ?? 0) : sqlite;
  h = new LocalHost({ store, config, alarm: 'manual' });
  await h.start();
  beginTrace(h.core.store, h.core.now());
  return { host: h, db };
}

let { host, db } = await fresh();

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
 *  a runner's own `Baton-Client`, reach Baton as they are. A step of the scenario's trace like
 *  any other (R3-1244): `raw` changes what is sent, never that it was. */
export async function raw(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin: Origin = { kind: 'request', method: req.method, path: url.pathname + url.search, body: parse(req.body ? await req.clone().text() : undefined) };
  const res = await origins.run(origin, () => host.handle(req));
  origin.status = res.status;
  origin.response = parse(await res.clone().text());
  return res;
}

function parse(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  }
}

/** Run `fn` with the core, in its turn in the queue. */
export function withCore<T>(fn: (core: BatonCore) => T | Promise<T>): Promise<T> {
  return host.queue.run(() => fn(host.core));
}

/** The host adapter without core's versioning or the trace recorder. */
export async function withStore<T>(fn: (store: Store) => T): Promise<T> {
  const { db, store } = openStore(':memory:');
  try {
    return fn(store);
  } finally {
    db.close();
  }
}

/** One alarm tick, in its turn — its commits are steps of the trace too (R3-1244). */
export function tick(): Promise<void> {
  return origins.run({ kind: 'alarm' }, () => host.tick());
}

/** Every test starts from an empty Baton: a new in-memory database. */
export async function reset({ trace = true } = {}): Promise<void> {
  await host.stop();
  db.close();
  ({ host, db } = await fresh(trace));
}

/** Write the test's steps as its scenario's trace (R3-1244): test/.traces/<scenario>/<test>.itf.json,
 *  for the integration scenarios only. */
export async function writeTrace(testPath: string, test: string): Promise<void> {
  const steps = takeSteps();
  if (!testPath.includes('/test/integration/') || !steps.length) return;
  const scenario = basename(testPath).replace(/\.test\.ts$/, '');
  const name = test.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'test';
  const dir = resolve(import.meta.dirname, '../.traces', scenario);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.itf.json`), JSON.stringify(toItf(scenario, test, steps)));
}
