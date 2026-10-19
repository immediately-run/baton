// bundle.mjs — the local host as one Node module (BATON_SPEC §3a R-BTN-55): esbuild bundles a
// src/local entry with the schema migrations and the dashboard as text, as wrangler's Text rule
// does for the Worker. `npm run start:local` and `baton test-course` (R3-1248) both run through it.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.local');

/** The dashboard's ES module is served to the browser, never run here: load it as text. */
export const uiScriptAsText = {
  name: 'ui-script-as-text',
  setup(b) {
    b.onLoad({ filter: /[\\/]ui[\\/]app\.js$/ }, async (args) => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  },
};

/** The schema migrations and the dashboard load as text, as wrangler's Text rule does. */
export const LOCAL_LOADERS = { '.sql': 'text', '.html': 'text', '.css': 'text' };

/** Bundle `entry` (relative to the repository root) to .local/`name` and import it. */
export async function bundleLocal(entry, name) {
  mkdirSync(OUT, { recursive: true });
  const outfile = join(OUT, name);
  await build({
    entryPoints: [join(ROOT, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    loader: LOCAL_LOADERS,
    plugins: [uiScriptAsText],
    logLevel: 'warning',
  });
  return import(pathToFileURL(outfile).href);
}
