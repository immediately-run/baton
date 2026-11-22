// R-BTN-133 (S-BTN-109): preparation has its own deadline and never calls leg hooks.
import { randomUUID } from 'node:crypto';
import { type Executor, type ExecResult } from './executor';

export class PreparationError extends Error {
  constructor(readonly kind: 'spec' | 'capability' | 'transient', message: string) { super(message); }
}

export const PREPARE_TIMEOUT_MS = 15 * 60_000;

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
  const handle = await executor.start({ brief: { kind: 'install', session_id: `prepare-${randomUUID()}`, checkout: cwd, paths: [], wrapper, env } });
  let stopping: Promise<void> | undefined;
  const stop = () => {
    const reason = !signal.aborted ? 'preparation-ended'
      : String(signal.reason).startsWith('released:') ? 'preparation-release' : 'preparation-stopped';
    stopping ??= executor.stop(handle, reason);
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    const result = await executor.exec(handle, argv, { cwd }).result;
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
    await stopping;
  }
}
