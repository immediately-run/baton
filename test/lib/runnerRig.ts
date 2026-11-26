import { BatonApi } from '../../src/runner/api';
import { Runner, type RunnerOptions } from '../../src/runner/runner';
import { call as hostCall } from '#host';
import { ORIGIN, TOKENS, setClock } from '../helpers';

/** The integration runner speaks to the test host, never to a live instance. */
export function runnerApi({ url = ORIGIN, credential = 'vm-a', transport = hostCall }: {
  url?: string; credential?: keyof typeof TOKENS; transport?: typeof hostCall;
} = {}): BatonApi {
  return new BatonApi({ url, transport, auth: (_method, _url, _body, secret) => ({
    Authorization: `Bearer ${TOKENS[credential]}`, ...(secret ? { 'X-Runner-Secret': secret } : {}),
  }) });
}

export function testRunner(options: Pick<RunnerOptions, 'home' | 'session' | 'courses' | 'stateFile'> & Partial<RunnerOptions>): Runner {
  return new Runner({ api: runnerApi(), repository: 'docs', hostname: 'vm-a', harness: 'opencode', log: () => {}, ...options });
}

/** Time in the runner and the core advances only when the scenario says it does. */
export function runnerClock(start: number) {
  let at = start;
  return { now: () => at, async set(ms: number) { at = ms; await setClock(ms); } };
}

/** Wait for observable async work (e.g. a child process), never for a lease to lapse. */
export async function until<T>(read: () => Promise<T> | T, ready: (value: T) => boolean = Boolean, what = 'condition'): Promise<T> {
  const end = performance.now() + 30_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (performance.now() >= end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
