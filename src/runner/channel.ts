// channel.ts — the leg's channel (BATON_SPEC §8.2 R-BTN-106's raise path; B-234): the one way a
// leg session speaks to its runner. Under `builtin` it is a Unix socket in the runner's state
// directory, mode 0600, one per leg run, its address handed to the session as BATON_SOCKET —
// the interface names an address, not a transport, so an executor may carry it however it
// likes. JSON lines, wrapped by the CLI (`baton leg raise`, R-BTN-160; `baton leg done`).
//
// The verbs this build carries are the two R-BTN-195 needs — `raise` (checked by the runner,
// answered on the channel, reported to Baton only when it passes: the subject and body stay in
// the runner's log, R-BTN-33) and `done` (the posted ending of a joinable session, R-BTN-107:
// a session that does not exit when its agent is done ends at the result posted on its
// channel). Everything else is refused: the channel carries no raw `advance` or `end`, and no
// `executor_digest`, `environment` or `instance` — the runner reports those itself.
import { createConnection, Server as SocketServer, type Socket } from 'node:net';
import { chmodSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** One request as the CLI writes it: `op` plus the verb's own fields. */
export interface ChannelRequest {
  op: string;
  [k: string]: unknown;
}

/** The channel's answer: `ok` with the verb's own fields, or the reason it was refused. */
export type ChannelAnswer = { ok: true; [k: string]: unknown } | { ok: false; error: string };

/** The requests this build carries; anything else is refused naming the channel's verbs. */
const OPS = new Set(['raise', 'done']);

/**
 * The runner's half: one socket per leg run, served while the run's session is live. `posted`
 * resolves at the ending a joinable session posts (`done`, R-BTN-107/R-BTN-195) — the runner
 * races the session's own exit against it — and refuses nothing else itself: every request is
 * answered by the handler the runner hands `listen`, which holds the run's facts.
 */
export class LegChannel {
  private readonly server: SocketServer;
  private readonly clients = new Set<Socket>();
  private handler: ((req: ChannelRequest) => Promise<ChannelAnswer>) | null = null;
  private postedResolve: ((ending: { result: unknown }) => void) | null = null;
  /** R-BTN-107/R-BTN-195: the ending posted on the channel, once; never settles otherwise. */
  readonly posted: Promise<{ result: unknown }>;

  private constructor(readonly path: string) {
    this.posted = new Promise((resolve) => { this.postedResolve = resolve; });
    this.server = new SocketServer({ allowHalfOpen: true });
    this.server.on('connection', (sock) => {
      this.clients.add(sock);
      // A client that dies mid-line (its leg was killed) resets the socket: its request is
      // moot, never the runner's — answered or not, nothing is owed a dead caller.
      sock.on('error', () => { this.clients.delete(sock); });
      sock.on('close', () => this.clients.delete(sock));
      // One line in, one line out, in order: a CLI call is a single request, and a session that
      // opens one connection per call never interleaves.
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString('utf8');
        let at;
        while ((at = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, at);
          buf = buf.slice(at + 1);
          if (line.trim() === '') continue;
          void this.answer(sock, line);
        }
      });
    });
  }

  /** Serve at `path` (the runner's state directory, mode 0600, R-BTN-106). The socket file a
   *  dead runner left is removed first: the runner that owns this directory is the only writer
   *  (the state-file lock beside it). */
  static serve(path: string): Promise<LegChannel> {
    const channel = new LegChannel(path);
    rmSync(path, { force: true });
    return new Promise<LegChannel>((resolve, reject) => {
      const fail = (e: Error) => { channel.server.off('error', fail); reject(e); };
      channel.server.once('error', fail);
      channel.server.listen(path, () => {
        channel.server.off('error', fail);
        try { chmodSync(path, 0o600); } catch { /* the directory's own mode governs */ }
        resolve(channel);
      });
    });
  }

  /** The runner's answers, one per request; each call is awaited before its line goes out. */
  listen(handler: (req: ChannelRequest) => Promise<ChannelAnswer>): void {
    this.handler = handler;
  }

  private async answer(sock: Socket, line: string): Promise<void> {
    const send = (answer: ChannelAnswer) => { sock.write(`${JSON.stringify(answer)}\n`); };
    const fail = (error: string) => send({ ok: false, error });
    let req: ChannelRequest;
    try {
      const parsed = JSON.parse(line) as ChannelRequest;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.op !== 'string') return fail('a channel request is {"op": …} of one JSON line');
      req = parsed;
    } catch {
      return fail('a channel request is one JSON line');
    }
    if (!OPS.has(req.op)) {
      return fail(`the channel carries raise and done, nothing else: ${JSON.stringify(req.op)} is not a verb of it (R-BTN-106)`);
    }
    if (req.op === 'done') {
      // The one ending: a second is refused, the first resolves the joinable wait.
      if (this.postedResolve == null) return fail('the leg has already ended');
      this.postedResolve({ result: req.result ?? null });
      this.postedResolve = null;
      return send({ ok: true });
    }
    try {
      const out = await this.handler?.(req) ?? { ok: false as const, error: 'the runner serves no channel yet' };
      send(out);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  /** Stop serving and remove the socket; the run's session is over. */
  close(): void {
    for (const c of this.clients) c.destroy();
    this.clients.clear();
    this.server.close();
    rmSync(this.path, { force: true });
  }
}

/** The socket's address for a leg run's session, in the runner's state directory. */
export const channelPath = (stateFile: string, sessionId: string): string =>
  join(dirname(stateFile), `leg-${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.sock`);

/**
 * The session's half (the CLI's): one connection, one request, one answer. `timeoutMs` bounds
 * the wait — a harness agent calling the CLI cannot hang on a runner that stopped serving.
 */
export function callChannel(path: string, req: ChannelRequest, timeoutMs = 30_000): Promise<ChannelAnswer> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path);
    let buf = '';
    const finish = (fn: () => void) => {
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
          resolve(JSON.parse(line) as ChannelAnswer);
        } catch {
          reject(new Error(`the runner's channel answered a line that is not JSON: ${line.slice(0, 120)}`));
        }
      });
    });
    sock.on('connect', () => sock.write(`${JSON.stringify(req)}\n`));
  });
}
