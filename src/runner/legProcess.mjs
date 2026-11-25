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
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , call, script] = process.argv;
const stop = new AbortController();

function verifySource(root, blobs) {
  let count = 0;
  const walk = (dir, prefix) => {
    const mode = lstatSync(dir);
    if (!mode.isDirectory() || (mode.mode & 0o222)) throw new Error('the verified source directory changed');
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = prefix + entry.name;
      if (entry.isDirectory()) walk(path, `${rel}/`);
      else {
        if (!entry.isFile() || !Object.hasOwn(blobs, rel) || (lstatSync(path).mode & 0o222) ||
            createHash('sha256').update(readFileSync(path)).digest('hex') !== blobs[rel]) {
          throw new Error(`the verified source file ${rel} changed`);
        }
        count++;
      }
    }
  };
  walk(root, '');
  if (count !== Object.keys(blobs).length) throw new Error('the verified source tree is incomplete');
}

async function runSourced(ctx, id, source, standard) {
  const git = (...argv) => execFileSync('git', ['-C', ctx.checkout, ...argv], {
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 16 << 20,
  });
  const base = `.baton/courses/${id}/legs`;
  const leg = ctx.leg;
  if (![id, leg].every((name) => /^[a-z][a-z0-9-]*$/.test(name))) throw new Error('invalid sourced leg name');
  const snapshot = (group) => {
    const sha = ctx.signed_control?.[group] ?? ctx.snapshot.sha;
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('the leg has no verified home snapshot');
    return sha;
  };
  const instructionsSha = snapshot('course');
  const overridesSha = snapshot('overrides');
  const entries = (sha) => git('ls-tree', '-z', sha, '--', `${base}/`).toString().split('\0').filter(Boolean);
  const find = (rows, match) => rows.flatMap((row) => {
    const [meta, name] = row.split('\t');
    if (!name?.startsWith(`${base}/`) || !match(name.slice(base.length + 1))) return [];
    if (!/^100(644|755) blob /.test(meta)) throw new Error(`${name}: expected a regular override`);
    return [name];
  });
  const courseRows = entries(instructionsSha);
  const [instructions] = find(courseRows, (name) => name === `${leg}.md`);
  const overrides = find(overridesSha === instructionsSha ? courseRows : entries(overridesSha),
    (name) => name.startsWith(`${leg}.run.`));
  if (overrides.length > 1) throw new Error(`${leg}: multiple run overrides at ${overridesSha}`);
  if (overrides[0] && !/\.(?:mjs|js|cjs)$/.test(overrides[0])) throw new Error(`${overrides[0]}: unsupported run override`);
  const dir = mkdtempSync(join(tmpdir(), 'baton-source-run-'));
  try {
    const fallback = `legs/${leg}.md`;
    const path = instructions ? join(dir, `${leg}.md`) : source && Object.hasOwn(source.blobs, fallback) ? join(dirname(script), `${leg}.md`) : '';
    if (instructions) writeFileSync(path, git('show', `${instructionsSha}:${instructions}`), { mode: 0o400 });
    process.env.BATON_INSTRUCTIONS = path;
    ctx.instructions = path;
    if (overrides.length === 0) return await standard(ctx);
    const file = join(dir, overrides[0].slice(base.length + 1));
    writeFileSync(file, git('show', `${overridesSha}:${overrides[0]}`), { mode: 0o400 });
    if (file.endsWith('.js')) writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const override = await import(pathToFileURL(file).href);
    const run = override.run ?? override.default?.run;
    if (typeof run !== 'function') throw new Error(`${overrides[0]} exports no run(ctx, standard)`);
    return await run(ctx, standard);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
const args = await new Promise((resolveArgs, rejectArgs) => {
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
  if (!Array.isArray(args)) throw new Error('legProcess: the arguments are not a JSON array');
  const source = ['run', 'close', 'handoff'].includes(call) ? args[0]?.fetched_course : null;
  if (source) verifySource(dirname(dirname(script)), source.blobs);
  const mod = await import(pathToFileURL(script).href);
  const holder = mod.default != null && typeof mod.default === 'object' ? mod.default : null;
  // `describe`: what a ticket source declares (§4.2) — its `versions`, and whether it reads.
  if (call === 'describe') {
    const src = holder ?? mod;
    finish({ ok: true, result: { versions: typeof src.versions === 'string' ? src.versions : null, read: typeof src.read === 'function' } }, 0);
  }
  const owner = typeof mod[call] === 'function' ? mod : holder != null && typeof holder[call] === 'function' ? holder : null;
  const fn = owner != null ? owner[call] : call === 'run' && typeof mod.default === 'function' ? mod.default : undefined;
  if (typeof fn !== 'function') throw new Error(`the script exports no ${call}()`);
  if (call === 'run') {
    if (args[0]?.reads_only === true && mod.readsOnly !== true) {
      throw new Error('a reads_only leg needs a stub that supports reads_only (R-BTN-183)');
    }
    args[0] = { ...args[0], signal: stop.signal };
  }
  if (call === 'stations') args[0] = { ...args[0], closed: new Set(args[0].closed), done: new Set(args[0].done) };
  const result = call === 'run' && args[0]?.sourced_course_id
    ? await runSourced(args[0], args[0].sourced_course_id, source, typeof mod.standard === 'function' ? mod.standard : (ctx) => fn.call(owner, ctx))
    : await fn.apply(owner, args);
  finish({ ok: true, result: result === undefined ? null : result }, 0);
} catch (e) {
  finish({ ok: false, error: e instanceof Error ? e.message : String(e), aborted: stop.signal.reason === undefined ? null : String(stop.signal.reason) }, stop.signal.reason === undefined ? 4 : 5);
}
