import type { ExecFileSyncOptions } from 'node:child_process';

type GitOptions = Pick<ExecFileSyncOptions, 'cwd' | 'input' | 'stdio' | 'maxBuffer'> & {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

export const GIT_TIMEOUT_MS: number;
export function git(root: string | null, args: string[], options?: GitOptions): string;
export function gitText(root: string, ...args: string[]): string;
export function gitBuffer(root: string, args: string[]): Buffer;
export function gitAsync(root: string | null, args: string[], timeoutMs: number): Promise<string>;
