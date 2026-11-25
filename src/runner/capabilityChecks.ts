import { execFile } from 'node:child_process';

export interface CapabilityCheck { name: string; check?: [string, ...string[]]; every_s?: number }

/** Checks come only from the host's runner config, never from the course or checkout. */
export function capabilityChecks(config: unknown, cwd: string, env: NodeJS.ProcessEnv) {
  if (!config || typeof config !== 'object') throw new Error('runner config must be an object');
  const { origin, capabilities } = config as { origin?: unknown; capabilities?: unknown };
  if (origin !== undefined && (typeof origin !== 'string' || !/^https?:\/\/[^/]+$/.test(origin))) throw new Error('runner config origin must be an HTTP(S) origin');
  if (!Array.isArray(capabilities) || capabilities.length > 128) throw new Error('runner config capabilities must be a list (at most 128)');
  const entries = new Map<string, CapabilityCheck>();
  const results = new Map<string, { at: number; ok: boolean }>();
  const pending = new Map<string, Promise<void>>();
  for (const c of capabilities) {
    if (!c || typeof c.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/.test(c.name) || entries.has(c.name)
      || (c.check !== undefined && (!Array.isArray(c.check) || !c.check.length || c.check.length > 64 || c.check.some((a: unknown) => typeof a !== 'string' || !a.length || a.includes('\0'))))
      || (c.every_s !== undefined && (!Number.isSafeInteger(c.every_s) || c.every_s < 1))) throw new Error('invalid runner capability check');
    entries.set(c.name, c);
  }
  const refresh = async (now: () => number, force = false) => {
    await Promise.all([...entries.values()].map(async ({ name, check, every_s = 300 }) => {
      if (!check) return;
      if (pending.has(name)) return pending.get(name);
      const last = results.get(name);
      if (last && (!force || !last.ok) && now() - last.at < every_s * 1000) return;
      const [file, ...args] = check;
      const run = new Promise<void>((resolve) => {
        execFile(file, args, { cwd, env, timeout: 60_000, killSignal: 'SIGKILL', windowsHide: true }, (error) => {
          results.set(name, { at: now(), ok: !error });
          resolve();
        });
      }).finally(() => pending.delete(name));
      pending.set(name, run);
      await run;
    }));
  };
  return { origin, names: [...entries.keys()], refresh, passes: (name: string) => !entries.get(name)?.check || results.get(name)?.ok === true };
}
