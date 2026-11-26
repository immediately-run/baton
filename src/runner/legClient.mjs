// The script and CLI share the same R-BTN-106 channel client.
import { createConnection } from 'node:net';

// The script can resolve Baton from a different installation than the runner's wrapper.
const typed = Symbol.for('@immediately-run/baton.LegError');

export class LegError extends Error {
  constructor(type, message) {
    super(message);
    this.name = 'LegError';
    this.type = type;
    this[typed] = true;
  }
}

export const legErrorType = (error) => error instanceof Error && error[typed] === true && typeof error.type === 'string' ? error.type : undefined;

export async function raise(type, options) {
  const path = process.env.BATON_SOCKET;
  if (!path) throw new Error('not inside a leg: BATON_SOCKET is not set');
  const answer = await callChannel(path, { ...options, op: 'raise', type });
  if (!answer.ok) throw new Error(answer.error);
  return answer;
}

/**
 * The session's half (the CLI's): one connection, one request, one answer. `timeoutMs` bounds
 * the wait — a harness agent calling the CLI cannot hang on a runner that stopped serving.
 */
export function callChannel(path, req, timeoutMs = 30_000) {
  const line = `${JSON.stringify(req)}\n`;
  return new Promise((resolve, reject) => {
    const sock = createConnection(path);
    let buf = '';
    const finish = (fn) => {
      sock.destroy();
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`the runner's channel (${path}) did not answer within ${timeoutMs / 1000}s`))), timeoutMs);
    timer.unref?.();
    sock.on('error', (e) => finish(() => reject(new Error(`the runner's channel (${path}) is not serving: ${e.message}`))));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const at = buf.indexOf('\n');
      if (at < 0) return;
      const line = buf.slice(0, at);
      finish(() => {
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`the runner's channel answered a line that is not JSON: ${line.slice(0, 120)}`));
        }
      });
    });
    sock.on('end', () => finish(() => reject(new Error('the runner closed the channel without an answer'))));
    sock.on('connect', () => sock.write(line));
  });
}
