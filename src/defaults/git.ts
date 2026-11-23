// One argv-only git seam for the CLI, defaults and runner (B-94, S-BTN-41).
import { execFile, execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { GIT_NONINTERACTIVE_ENV } from '../client/git-env.mjs';

export const GIT_TIMEOUT_MS = 30_000;

type GitOptions = Pick<ExecFileSyncOptions, 'cwd' | 'input' | 'stdio' | 'maxBuffer'> & {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

const argv = (root: string | null, args: string[]) => root == null ? args : ['-C', root, ...args];
const limits = ({ timeoutMs = GIT_TIMEOUT_MS, cwd, env, maxBuffer = 16 << 20 }: GitOptions) => ({
  cwd,
  timeout: timeoutMs,
  killSignal: 'SIGKILL' as const,
  maxBuffer,
  env: { ...process.env, LC_ALL: 'C', ...GIT_NONINTERACTIVE_ENV, ...env },
});

/** Preserve raw output: `git show` reads file bytes, including a trailing newline. */
export function git(root: string | null, args: string[], options: GitOptions = {}): string {
  const { input, stdio = [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] } = options;
  return execFileSync('git', argv(root, args), { ...limits(options), encoding: 'utf8', stdio, input });
}

export const gitText = (root: string, ...args: string[]): string => git(root, args).trim();

export function gitBuffer(root: string, args: string[]): Buffer {
  return execFileSync('git', argv(root, args), { ...limits({}), stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Clone/fetch in a runner slot must not block the heartbeat. */
export function gitAsync(root: string | null, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', argv(root, args), { ...limits({ timeoutMs }), encoding: 'utf8' },
      (e, stdout, stderr) => e ? reject(new Error(`git ${args[0]}: ${String(stderr || e.message).trim().slice(0, 300)}`)) : resolve(stdout));
    child.stdin?.end();
  });
}
