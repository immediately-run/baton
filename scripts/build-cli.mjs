#!/usr/bin/env node
// build-cli.mjs — the `baton` CLI as one prebuilt module for the published package. A checkout
// runs cli/baton.mjs and bundles each TypeScript subcommand on demand (scripts/baton-run.mjs,
// scripts/baton-cli.mjs, scripts/bundle.mjs), which needs esbuild, a devDependency. Here each of
// those three is swapped for its TypeScript source, so dist/baton.mjs runs with dependencies only.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCAL_LOADERS, uiScriptAsText } from './bundle.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist');
const src = (path) => JSON.stringify(join(ROOT, path));

/** Each on-demand bundler cli/baton.mjs imports, as the module it would have bundled. */
const PREBUILT = {
  'baton-run.mjs': `export { runMain } from ${src('src/runner/main.ts')};`,
  'baton-cli.mjs': `export { initMain, parseSyncArgs, syncMain } from ${src('src/defaults/cli.ts')};`,
  'bundle.mjs': `const ENTRIES = { 'src/local/testCourse.ts': () => import(${src('src/local/testCourse.ts')}) };
export async function bundleLocal(entry) {
  const load = ENTRIES[entry];
  if (!load) throw new Error(\`build-cli: \${entry} is not prebuilt — add it to scripts/build-cli.mjs\`);
  return load();
}`,
};

const prebuilt = {
  name: 'prebuilt-subcommands',
  setup(b) {
    const filter = new RegExp(`^\\.\\./scripts/(${Object.keys(PREBUILT).map((n) => n.replace('.', '\\.')).join('|')})$`);
    b.onResolve({ filter }, (args) => ({ path: args.path.slice('../scripts/'.length), namespace: 'prebuilt' }));
    b.onLoad({ filter: /.*/, namespace: 'prebuilt' }, (args) => ({ contents: PREBUILT[args.path], loader: 'js', resolveDir: ROOT }));
  },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: [join(ROOT, 'cli/baton.mjs')],
  outfile: join(OUT, 'baton.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  loader: { ...LOCAL_LOADERS, '.json': 'json', '.txt': 'text' },
  plugins: [prebuilt, uiScriptAsText],
  logLevel: 'warning',
});
// The runner spawns its leg process by path (src/runner/runner.ts LEG_PROCESS), beside the bundle.
copyFileSync(join(ROOT, 'src/runner/legProcess.mjs'), join(OUT, 'legProcess.mjs'));
