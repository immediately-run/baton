#!/usr/bin/env node
// baton-cli.mjs — the `baton repo sync` and `baton repo init` bundle (BATON_SPEC §2f R-BTN-74): bundles
// src/defaults/cli.ts with esbuild the way scripts/baton-run.mjs bundles the runner, and
// re-exports its command entrypoints. The bundle lands in `.local/` (gitignored) and is
// rebuilt on every start, so the commands a checkout runs are always its current source.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
