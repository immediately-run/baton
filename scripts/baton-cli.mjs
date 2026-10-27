#!/usr/bin/env node
// baton-cli.mjs — the `baton repo sync`, `baton repo init` and `baton tickets check` bundle
// (BATON_SPEC §2f R-BTN-74; B-111): bundles `src/defaults/cli.ts` and
// `src/defaults/tickets-check.ts` with esbuild the way scripts/baton-run.mjs bundles the runner,
// and re-exports their command entrypoints. The bundle lands in `.local/` (gitignored) and is
// rebuilt on every start, so the commands a checkout runs are always its current source.
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

// B-111: `baton tickets check`, built the same way and re-exported beside the repo commands.
const CHECK = join(ROOT, '.local', 'baton-tickets-check', String(process.pid), 'check.mjs');
await build({
  entryPoints: [join(ROOT, 'src/defaults/tickets-check.ts')],
  outfile: CHECK,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
});
const checked = await import(pathToFileURL(CHECK).href);
export const checkTicketsMain = checked.checkTicketsMain;
// The check's bundle is this process's alone — another process builds its own under its own pid —
// and it is this run's cache only: it goes once loaded, before the child's imports run.
rmSync(dirname(CHECK), { recursive: true, force: true });
