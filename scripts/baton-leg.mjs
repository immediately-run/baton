#!/usr/bin/env node
// baton-leg.mjs — the leg session's bundle: `baton leg raise` (R-BTN-106, R-BTN-160, R-BTN-195;
// B-234), bundled with esbuild the way scripts/baton-run.mjs bundles the runner, and re-exporting
// its entry. Its own file (never beside `run` and `replay`) so a raise inside a leg pays for one
// small bundle, not the runner's. The bundle lands in `.local/` per process and is rebuilt on
// every start, so the command a checkout runs is always its current source.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.local');
mkdirSync(OUT, { recursive: true });

const outfile = join(OUT, `baton-leg-${process.pid}.mjs`);
await build({
  entryPoints: [join(ROOT, 'src/runner/leg.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  loader: { '.json': 'json' },
  logLevel: 'warning',
});

export const { legMain } = await import(pathToFileURL(outfile).href);
