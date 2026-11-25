export class LegError extends Error {
  constructor(type: string, message: string);
  readonly type: string;
}

type Answer = { ok: true; [key: string]: unknown } | { ok: false; error: string };
export function callChannel(path: string, request: { op: string; [key: string]: unknown }, timeoutMs?: number): Promise<Answer>;
export function legErrorType(error: unknown): string | undefined;
export function raise(type: string, options: {
  subject: string;
  body?: string;
  restarts?: Record<string, string>;
  default?: string;
  severity?: 'critical' | 'high' | 'normal';
}): Promise<Extract<Answer, { ok: true }>>;
