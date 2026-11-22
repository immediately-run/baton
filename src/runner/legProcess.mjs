#!/usr/bin/env node
// legProcess.mjs — the wrapper every call into repository code runs (BATON_SPEC §8.4 R-BTN-133,
// §8.3 R-BTN-107; B-184). The runner runs it through its executor's `exec`, so no repository code
// loads in the runner — under `builtin` a detached child in its own process group, under another
// executor wherever that executor's sessions run:
//
//   node legProcess.mjs <call> <script>
//
// `<call>` names the export to call — `run`, `close`, `handoff`, or a ticket source's `read` (and
// `describe`, which reports the source's `versions` and whether it exports `read`) —
// by name or on the default export (a `run` may also be the default export itself, §6.13).
// stdin's first line is the call's arguments as a JSON array (`run`: [ctx]; `close`: [ctx,
// result]; `handoff`: [ctx]; `read`: [id, options]); under `run` the lines after it are abort
// reasons — `release` or `regressed`, §6.13's closed set — fired on the AbortSignal `ctx.signal`
// carries. The outcome is stdout's LAST line: `{"ok": true, "result": …}` or `{"ok": false,
// "error": …, "aborted": …}`, written synchronously before the process exits.
import { realpathSync, writeSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, , call, script] = process.argv;
const stop = new AbortController();

// macOS injects this CoreFoundation implementation detail into every new process even when the
// parent supplies an otherwise empty environment (`env -i node …`). A replay's contract is the
// explicit allowlist assembled by replayEnvironment; remove the host-added name before any
// repository module loads. It is absent on Linux, and ordinary non-replay legs are unchanged.
if (process.env.BATON_REPLAY === '1') delete process.env.__CF_USER_TEXT_ENCODING;

const finish = (out, code) => {
  writeSync(1, `\n${JSON.stringify(out)}\n`);
  process.exit(code);
};

/** The arguments: stdin's first line. Later lines are abort reasons (`run` only). */
const input = await new Promise((resolveArgs, rejectArgs) => {
  let buffer = '';
  let first = null;
  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (first == null) {
        first = line;
        try {
          resolveArgs(JSON.parse(line));
        } catch (e) {
          rejectArgs(new Error(`legProcess: stdin's first line is not a JSON array of arguments (${e.message})`));
        }
        continue;
      }
      if (!line.trim()) continue;
      try {
        const { abort } = JSON.parse(line);
        if (abort) stop.abort(abort);
      } catch {
        // A malformed line is dropped loudly on stderr, never fatal: the leg keeps its lease
        // semantics from the parent's real signals.
        process.stderr.write(`legProcess: ignoring a malformed abort line: ${line}\n`);
      }
    }
  });
  process.stdin.on('end', () => {
    if (first == null) rejectArgs(new Error('legProcess: stdin closed before the arguments arrived'));
  });
  process.stdin.on('error', () => {}); // the parent may close stdin when it kills us
}).catch((e) => finish({ ok: false, error: e.message, aborted: null }, 4));

try {
  const args = Array.isArray(input) ? input : input?.args;
  if (!Array.isArray(args)) throw new Error('legProcess: the arguments are not a JSON array');
  if (!Array.isArray(input)) {
    const roots = input.roots.map((dir) => realpathSync(dir));
    registerHooks({ resolve(specifier, context, next) {
      const out = next(specifier, context);
      if (out.url.startsWith('node:')) return out;
      const file = out.url.startsWith('file:') ? realpathSync(fileURLToPath(out.url)) : null;
      if (file && roots.some((dir) => file === dir || file.startsWith(dir + sep))) return out;
      throw new Error(`import ${specifier} resolves outside the verified leg tree and dependency cache (R-BTN-133)`);
    } });
  }
  const mod = await import(pathToFileURL(script).href);
  const holder = mod.default != null && typeof mod.default === 'object' ? mod.default : null;
  const exported = (name) => typeof mod[name] === 'function' ? mod[name]
    : typeof holder?.[name] === 'function' ? holder[name] : name === 'run' ? mod.default : undefined;
  if (call === 'exports') finish({ ok: true, result: ['run', 'handoff', 'close'].filter((name) => typeof exported(name) === 'function') }, 0);
  // `describe`: what a ticket source declares (§4.2) — its `versions`, and whether it reads.
  if (call === 'describe') {
    const src = holder ?? mod;
    finish({ ok: true, result: { versions: typeof src.versions === 'string' ? src.versions : null, read: typeof src.read === 'function' } }, 0);
  }
  const owner = typeof mod[call] === 'function' ? mod : holder != null && typeof holder[call] === 'function' ? holder : null;
  const fn = exported(call);
  if (typeof fn !== 'function') throw new Error(`the script exports no ${call}()`);
  if (call === 'run') args[0] = { ...args[0], signal: stop.signal };
  const result = await fn.apply(owner, args);
  finish({ ok: true, result: result === undefined ? null : result }, 0);
} catch (e) {
  finish({ ok: false, error: e instanceof Error ? e.message : String(e), aborted: stop.signal.reason === undefined ? null : String(stop.signal.reason) }, stop.signal.reason === undefined ? 4 : 5);
}
