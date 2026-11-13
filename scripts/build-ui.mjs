#!/usr/bin/env node
// build-ui.mjs — the dashboard's one bundle (BATON-UI-V2, B-193): esbuild builds src/dashboard
// into src/dashboard/dist/ — app.js (one IIFE, minified, the current Chrome, Firefox and Safari,
// JSX automatic) and app.css, from the stylesheet main.tsx imports — and copies index.html
// beside them. The three files are text the Worker and the local host embed (wrangler.toml's
// Text rule, scripts/bundle.mjs) and the published CLI embeds too (scripts/build-cli.mjs),
// exactly as V1's were. dist/ is gitignored, so every path that needs it builds first: pretest,
// pretest:baton, pretest:no-quint, pretypecheck, predev, prestart:local, prebuild:cli — and
// baton-deploy.yml runs it before `wrangler deploy`.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src', 'dashboard');
const OUT = join(SRC, 'dist');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: [join(SRC, 'main.tsx')],
  outfile: join(OUT, 'app.js'),
  bundle: true,
  format: 'iife',
  minify: true,
  jsx: 'automatic',
  target: ['chrome141', 'firefox145', 'safari26'],
  logLevel: 'warning',
});
copyFileSync(join(SRC, 'index.html'), join(OUT, 'index.html'));
