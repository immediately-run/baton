#!/usr/bin/env node
// build-cli.mjs — the `baton` CLI as one prebuilt module for the published package. A checkout
// runs cli/baton.mjs and bundles each TypeScript subcommand on demand (scripts/baton-run.mjs,
// scripts/baton-cli.mjs, scripts/bundle.mjs), which needs esbuild, a devDependency. Here each of
// those three is swapped for its TypeScript source, so dist/baton.mjs runs with dependencies only.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCAL_LOADERS, uiScriptAsText } from './bundle.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist');
const src = (path) => JSON.stringify(join(ROOT, path));

/** Each on-demand bundler cli/baton.mjs imports, as the module it would have bundled. */
const PREBUILT = {
  'baton-run.mjs': `export { runMain } from ${src('src/runner/main.ts')};`,
  'baton-cli.mjs': `export { initMain, migrateMarkersMain, parseSyncArgs, syncMain } from ${src('src/defaults/cli.ts')};
export { ticketsMain } from ${src('src/defaults/tickets.ts')};
export { requestMain } from ${src('src/defaults/request.ts')};`,
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
// B-104: the built-in ontologies (src/defaults/ontology/baton@<n>.json) ship in the package;
// `builtInOntology` reads them beside the bundled code.
mkdirSync(join(OUT, 'defaults', 'ontology'), { recursive: true });
for (const name of ['baton@1']) copyFileSync(join(ROOT, 'src', 'defaults', 'ontology', `${name}.json`), join(OUT, 'defaults', 'ontology', `${name}.json`));

// What `baton repo init` writes, prebuilt (a package has no src/ and no esbuild), and the commit
// it was built from, which the package names as its courses' source and its workflow's pin
// (src/defaults/cli.ts cliPin). A modified tree is recorded as such, and that package pins nothing.
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim();
const { prebuildDefaults, remoteSlug } = await import('./baton-cli.mjs');
const repository = process.env.GITHUB_REPOSITORY ?? remoteSlug(ROOT);
if (!repository) throw new Error('build-cli: no origin remote names the repository the package is built from');
const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
const files = await prebuildDefaults(OUT, { repository, commit: git('rev-parse', 'HEAD'), ...(dirty ? { dirty: true } : {}) });
process.stderr.write(`build-cli: dist/baton.mjs and ${files} prebuilt defaults, ${repository}@${git('rev-parse', '--short', 'HEAD')}${dirty ? ' (modified tree)' : ''}\n`);
