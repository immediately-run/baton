// executor.ts — the leg executor (BATON_SPEC §8.3 R-BTN-107; B-184): every leg the CLI runner
// runs, and every call into repository code, goes through an executor whose code the runner's
// HOST chooses — `runner.json` `executor` or `baton run --executor <source>`, never a repository
// file. Baton is agnostic about isolation: an executor that isolates lives in its deployment's
// repository (Fieldhouse's E2B executor, for one), loaded here as a `pinned` bundle.
//
// Built here: the interface (`executor_api: 1`), `builtin` (the default — today's child
// processes, exactly), and `pinned:<path>@sha256:<digest>` (a host bundle, loaded only when its
// canonical listing's digest matches, its imports resolved only inside it). `home` is refused
// at start until its part of B-184 is built; `home-signed` is refused naming B-127.
//
// One deliberate widening of the spec's `exec(handle, argv, {cwd, timeout_s, stdin}) →
// {status, stdout, stderr}`: `exec` returns a running call — `result` is that promise, and
// `write(line)` appends a line to the call's stdin after the first (R-BTN-133's wrapper reads its
// arguments from stdin's first line and, under `run`, abort reasons from the lines after), and
// `kill()` stops that call's processes. An executor that cannot stream stdin may queue the lines.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXECUTOR_API = 1;

/** The kinds of session a runner starts (R-BTN-107): a leg's, and the calls with no leg. */
export type SessionKind = 'leg' | 'rank' | 'source' | 'sync' | 'install';

/** What a session is started with. `brief` never holds the claim id, the runner secret or a
 *  Baton credential (R-BTN-107). Paths are the runner host's: an executor whose sessions run
 *  elsewhere makes `checkout`, `paths` and `wrapper` available at the same paths there. */
export interface Brief {
  kind: SessionKind;
  /** The session's handle key: a leg's run id's session (`<run_id>.r<n>`), or `<kind>-<random>`. */
  session_id: string;
  run_id?: string;
  ticket?: string;
  leg?: string;
  /** The home checkout the session works in, at the claim's snapshot. */
  checkout: string;
  snapshot_sha?: string;
  /** Directories the session's calls read and write at these same paths: the claim's scratch
   *  (the advice and taken files) and the course's (the leg scripts, the ticket source). */
  paths: string[];
  /** The CLI's wrapper (R-BTN-133), which every call runs. */
  wrapper: string;
  /** The leg's environment as R-BTN-144 lists it — the executor decides what reaches the session. */
  env: Record<string, string>;
  reads_only?: boolean;
}

export interface StartOptions {
  brief: Brief;
  /** The leg's executor data (R-BTN-107): opaque to Baton, the executor's to validate. */
  executor?: Record<string, unknown> | null;
  inputs?: unknown[];
  /** The address of the leg's channel (R-BTN-106); absent while the channel is unbuilt. */
  channel?: string | null;
}

export interface ExecOptions {
  cwd: string;
  timeout_s?: number;
  /** stdin's first content; the call's stdin stays open for `write` until it ends. */
  stdin?: string;
  /** Extra environment for this call, over the session's. */
  env?: Record<string, string>;
  /** Each stderr line as it arrives (the runner's verbose drain, B-108). */
  onStderr?: (line: string) => void;
}

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface Running {
  result: Promise<ExecResult>;
  write(line: string): void;
  kill(): void;
}

export interface Handle {
  session_id: string;
  /** The session's link, reported as R-BTN-113 says. */
  link?: string | null;
  [k: string]: unknown;
}

export interface Executor {
  api: number;
  /** How the host chose it: `builtin` or `pinned` (the heartbeat's `source`). */
  source: string;
  digest: string;
  provides: string[];
  start(o: StartOptions): Promise<Handle>;
  exec(h: Handle, argv: string[], o: ExecOptions): Running;
  stop(h: Handle, reason: string): Promise<void>;
  end(h: Handle): Promise<{ status: string; result: unknown }>;
  salvage(h: Handle): Promise<{ sha: string; ref: string } | null>;
}

/** Context a pinned bundle's factory receives from the runner. */
export interface ExecutorHost {
  log: (line: string) => void;
  /** The CLI's wrapper path (R-BTN-133). */
  wrapper: string;
  /** The node binary that runs it on this host. */
  node: string;
}

// ---------------------------------------------------------------------------------------------
// builtin

/** `builtin`: every call a detached child of the runner, in its own process group, as its OS
 *  user — exactly today's `process` mode. A leg can read the runner's state file and use its
 *  ssh-agent: `builtin` binds only cooperating legs (R-BTN-107). `argv[0] === 'node'` runs the
 *  runner's own node. */
export function builtinExecutor(): Executor {
  const sessions = new Map<string, { brief: Brief; running: Set<Running> }>();
  return {
    api: EXECUTOR_API,
    source: 'builtin',
    digest: '',
    provides: [],
    async start({ brief }) {
      sessions.set(brief.session_id, { brief, running: new Set() });
      return { session_id: brief.session_id };
    },
    exec(h, argv, o) {
      const s = sessions.get(h.session_id);
      if (!s) throw new Error(`no session ${h.session_id}`);
      const [cmd, ...args] = argv;
      const child = spawn(cmd === 'node' ? process.execPath : cmd, args, {
        cwd: o.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...s.brief.env, ...(o.env ?? {}) },
      });
      const kill = () => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The group is already gone.
        }
      };
      let stdout = '';
      let stderr = '';
      let partial = '';
      child.stdout!.on('data', (d) => { stdout += d.toString('utf8'); });
      child.stderr!.on('data', (d) => {
        const text = d.toString('utf8');
        stderr += text;
        if (!o.onStderr) return;
        partial += text;
        let at;
        while ((at = partial.indexOf('\n')) >= 0) {
          o.onStderr(partial.slice(0, at));
          partial = partial.slice(at + 1);
        }
      });
      child.stdin!.on('error', () => {});
      if (o.stdin != null) child.stdin!.write(o.stdin);
      const timer = o.timeout_s ? setTimeout(kill, o.timeout_s * 1000) : null;
      timer?.unref?.();
      const result = new Promise<ExecResult>((resolveResult) => {
        child.on('error', (e) => {
          if (timer) clearTimeout(timer);
          resolveResult({ status: null, stdout, stderr: stderr + String(e) });
        });
        child.on('exit', (code) => {
          if (timer) clearTimeout(timer);
          // A call's end is its whole group's end (R-BTN-72, R-BTN-145): what the call left
          // behind goes with it.
          kill();
          if (partial && o.onStderr) o.onStderr(partial);
          resolveResult({ status: code, stdout, stderr });
        });
      });
      const running: Running = {
        result,
        write: (line) => {
          if (child.stdin && !child.stdin.destroyed) child.stdin.write(line.endsWith('\n') ? line : `${line}\n`);
        },
        kill,
      };
      s.running.add(running);
      void result.then(() => s.running.delete(running));
      return running;
    },
    async stop(h) {
      const s = sessions.get(h.session_id);
      if (!s) return;
      for (const r of s.running) r.kill();
      sessions.delete(h.session_id);
    },
    async end(h) {
      const s = sessions.get(h.session_id);
      if (s) await Promise.all([...s.running].map((r) => r.result));
      sessions.delete(h.session_id);
      return { status: 'ended', result: null };
    },
    async salvage() {
      return null; // B-186; `builtin`'s environment outlives the leg, so the runner may do it
    },
  };
}

// ---------------------------------------------------------------------------------------------
// pinned

/** R-BTN-107's canonical listing of a bundle: for each regular file, ordered by its `/`-separated
 *  path relative to the bundle (bytewise), `<path>` NUL `<sha256 hex>` newline; the digest is the
 *  SHA-256 of that listing. A symlink or any other non-regular entry refuses the bundle. */
export function bundleDigest(dir: string): string {
  const files: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) files.push(relative(dir, path).split(sep).join('/'));
      else throw new Error(`the executor bundle holds ${relative(dir, path)}, which is not a regular file or directory`);
    }
  };
  walk(dir);
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const listing = files.map((f) => `${f}\0${createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')}\n`).join('');
  return createHash('sha256').update(listing).digest('hex');
}

/** The bundles whose imports the resolve hook fences, by their real directory (with a trailing
 *  separator). One hook serves every bundle a process loads. */
const fenced = new Set<string>();
let hooked = false;

function fenceImports(dir: string) {
  fenced.add(dir.endsWith(sep) ? dir : dir + sep);
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, next) {
      const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : null;
      const bundle = parent ? [...fenced].find((d) => parent.startsWith(d)) : undefined;
      if (!bundle) return next(specifier, context);
      if (specifier.startsWith('node:')) return next(specifier, context);
      const out = next(specifier, context);
      const at = out.url.startsWith('file:') ? realpathSync(fileURLToPath(out.url)) : null;
      if (out.url.startsWith('node:') || (at && at.startsWith(bundle))) return out;
      throw new Error(`the pinned executor imports ${specifier}, outside its bundle (R-BTN-107)`);
    },
  });
}

/** Parse `--executor`/`runner.json` `executor` into what the runner loads. */
export function parseSource(source: string): { kind: 'builtin' } | { kind: 'home' } | { kind: 'home-signed' } | { kind: 'pinned'; path: string; digest: string } {
  if (source === 'builtin') return { kind: 'builtin' };
  if (source === 'home') return { kind: 'home' };
  if (source === 'home-signed') return { kind: 'home-signed' };
  const m = /^pinned:(.+)@sha256:([0-9a-f]{64})$/.exec(source);
  if (m) return { kind: 'pinned', path: m[1], digest: m[2] };
  throw new Error(`--executor ${source}: builtin, home, home-signed or pinned:<path>@sha256:<64 hex> (R-BTN-107)`);
}

/** Load the executor the host chose, or refuse to start (R-BTN-107). */
export async function loadExecutor(source: string, host: ExecutorHost): Promise<Executor> {
  const s = parseSource(source);
  if (s.kind === 'builtin') return builtinExecutor();
  if (s.kind === 'home-signed') throw new Error('--executor home-signed needs owner-signed control inputs (B-127), which are not built: this runner will not start with it');
  if (s.kind === 'home') throw new Error('--executor home is not built yet (B-184): use builtin or a pinned bundle');
  const dir = realpathSync(resolve(s.path));
  const digest = bundleDigest(dir);
  if (digest !== s.digest) throw new Error(`the executor bundle ${dir} has digest sha256:${digest}, not the pinned sha256:${s.digest}: this runner will not start with it`);
  fenceImports(dir);
  const mod = (await import(pathToFileURL(join(dir, 'executor.mjs')).href)) as { default?: unknown; createExecutor?: unknown };
  const factory = (mod.createExecutor ?? mod.default) as ((h: ExecutorHost) => Executor | Promise<Executor>) | undefined;
  if (typeof factory !== 'function') throw new Error(`the executor bundle's executor.mjs exports no createExecutor(host) (R-BTN-107)`);
  const ex = await factory(host);
  if (!ex || ex.api !== EXECUTOR_API) throw new Error(`the executor bundle speaks executor_api ${String(ex?.api)}, not ${EXECUTOR_API}`);
  for (const p of ex.provides ?? []) {
    if (typeof p !== 'string' || p.startsWith('runner:')) throw new Error(`the executor provides ${JSON.stringify(p)}: a provides name is a capability name and never starts runner: (R-BTN-107)`);
  }
  return { ...ex, source: 'pinned', digest, provides: [...(ex.provides ?? [])], start: ex.start.bind(ex), exec: ex.exec.bind(ex), stop: ex.stop.bind(ex), end: ex.end.bind(ex), salvage: (ex.salvage ?? (async () => null)).bind(ex) };
}
