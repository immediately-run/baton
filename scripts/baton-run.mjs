#!/usr/bin/env node
// baton-run.mjs — the runner-side bundles: `baton run` (BATON_SPEC §6.13 R-BTN-72) and
// `baton leg replay` (§9.8 R-BTN-84), each bundled with esbuild the way scripts/start-local.mjs
// bundles the local host, and re-exporting its entry. The bundles land in `.local/` (gitignored,
// per process) and are rebuilt on every start, so the commands a checkout runs are always its
// current source.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.local');
mkdirSync(OUT, { recursive: true });

// The runner spawns each leg through legProcess.mjs by path, beside its own module
// (src/runner/runner.ts LEG_PROCESS): without this copy every leg crashed, writing no result.
copyFileSync(join(ROOT, 'src/runner/legProcess.mjs'), join(OUT, 'legProcess.mjs'));

// `baton run`'s bundle keeps its fixed name (test/unit/runner-bundle.test.ts runs a leg through
// it); the replay bundle is this process's own, so two `baton` processes never rewrite each
// other's (the race scripts/baton-cli.mjs's per-pid directories close for its commands).
await build({
  entryPoints: [join(ROOT, 'src/runner/main.ts')],
  outfile: join(OUT, 'baton-run.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  loader: { '.json': 'json' },
  logLevel: 'warning',
});
await build({
  entryPoints: [join(ROOT, 'src/runner/replay.ts')],
  outfile: join(OUT, `baton-replay-${process.pid}.mjs`),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  loader: { '.json': 'json' },
  logLevel: 'warning',
});

export const { runMain } = await import(pathToFileURL(join(OUT, 'baton-run.mjs')).href);
export const { replayMain } = await import(pathToFileURL(join(OUT, `baton-replay-${process.pid}.mjs`)).href);
