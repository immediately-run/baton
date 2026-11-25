// R-BTN-133 (S-BTN-109): preparation has its own deadline and never calls leg hooks.
import { randomUUID } from 'node:crypto';
import { type Executor, type ExecResult } from './executor';

export class PreparationError extends Error {
  constructor(readonly kind: 'spec' | 'capability' | 'transient', message: string) { super(message); }
}

export const PREPARE_TIMEOUT_MS = 15 * 60_000;

const active = new WeakMap<AbortSignal, Set<() => Promise<void>>>();

/** The runner's last resort also waits for any pending session start before stopping it. */
export async function hardStopPreparation(controller: AbortController): Promise<void> {
  controller.abort('hard-stop');
  await Promise.all([...active.get(controller.signal) ?? []].map((stop) => stop()));
}

export function cleanNodeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] =>
    typeof e[1] === 'string' && e[0] !== 'NODE_OPTIONS' && e[0] !== 'NODE_PATH'));
}

export function requireLegNode(version = process.versions.node): void {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw new Error(`Baton requires Node >=22.18 for leg trees; found ${version} (R-BTN-133)`);
}

/** Use the same process-group and session contract for Git, the tree walker, and npm. */
export async function prepareExec(executor: Pick<Executor, 'start' | 'exec' | 'stop'>, wrapper: string,
  command: { argv: string[]; cwd: string; signal: AbortSignal; env?: NodeJS.ProcessEnv }): Promise<ExecResult> {
  const { argv, cwd, signal } = command;
  signal.throwIfAborted();
  const env = cleanNodeEnv(command.env ?? process.env);
  const starting = executor.start({ brief: { kind: 'install', session_id: `prepare-${randomUUID()}`, checkout: cwd, paths: [], wrapper, env } });
  let stops = active.get(signal);
  if (!stops) active.set(signal, stops = new Set());
  const hardStop = async () => {
    const handle = await starting.catch(() => null);
    if (handle) await executor.stop(handle, 'hard-stop');
  };
  stops.add(hardStop);
  let stopping: Promise<void> | undefined;
  const stop = () => {
    const reason = !signal.aborted ? 'preparation-ended'
      : String(signal.reason).startsWith('released:') ? 'preparation-release' : 'preparation-stopped';
    stopping ??= starting.then((handle) => executor.stop(handle, reason), () => {});
    // The abort listener cannot await, but the finally block below observes the same promise.
    void stopping.catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const handle = await starting;
    signal.throwIfAborted();
    const result = await executor.exec(handle, argv, { cwd }).result;
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
    try { await stopping; }
    finally { stops.delete(hardStop); }
  }
}
