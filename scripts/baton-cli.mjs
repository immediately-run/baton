#!/usr/bin/env node
// baton-cli.mjs — the `baton repo sync`, `baton repo init`, `baton tickets` and
// `baton request` bundle (BATON_SPEC §2f R-BTN-74; B-111; B-112; B-98 R-BTN-131): bundles
// `src/defaults/cli.ts`, `src/defaults/tickets.ts` and `src/defaults/request.ts` with
// esbuild the way scripts/baton-run.mjs bundles the runner, and re-exports their command
// entrypoints. The bundle lands in `.local/` (gitignored) and is rebuilt on every start, so the
// commands a checkout runs are always its current source.
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.local', 'baton-cli.mjs');
mkdirSync(join(ROOT, '.local'), { recursive: true });

await build({
  entryPoints: [join(ROOT, 'src/defaults/cli.ts')],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  loader: { '.json': 'json', '.txt': 'text' },
  logLevel: 'warning',
});

export const { initMain, parseSyncArgs, syncMain, prebuildDefaults, remoteSlug } = await import(pathToFileURL(OUT).href);

/** One command module bundled the same way. Each bundle is this run's own — another process
 *  builds its own — and it is deleted once loaded, before the child's imports run. */
async function bundleCommand(entry, load) {
  const file = join(ROOT, '.local', entry.replace(/\.ts$/, ''), String(process.pid), 'command.mjs');
  try {
    await build({
      entryPoints: [join(ROOT, 'src', 'defaults', entry)],
      outfile: file,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      packages: 'external',
      logLevel: 'warning',
    });
    // The entry, when a load fails: a bundle error reads as a bare SyntaxError otherwise.
    return await load(file);
  } catch (e) {
    throw new Error(`${entry} did not load: ${e?.message ?? e}`);
  } finally {
    rmSync(dirname(file), { recursive: true, force: true });
  }
}

// B-111's `baton tickets check` and B-112's `baton tickets new|claim|set|done`, built the same
// way and re-exported beside the repo commands.
const tickets = await bundleCommand('tickets.ts', (file) => import(pathToFileURL(file).href));
export const ticketsMain = tickets.ticketsMain;
// B-98: `baton request` — a course started from one sentence, filed as a ticket and pushed.
const requested = await bundleCommand('request.ts', (file) => import(pathToFileURL(file).href));
export const requestMain = requested.requestMain;
