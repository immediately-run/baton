#!/usr/bin/env node
// build-cli.mjs — the `baton` CLI as one prebuilt module for the published package. A checkout
// runs cli/baton.mjs and bundles each TypeScript subcommand on demand (scripts/baton-run.mjs,
// scripts/baton-cli.mjs, scripts/bundle.mjs), which needs esbuild, a devDependency. Here each of
// those three is swapped for its TypeScript source, so dist/baton.mjs runs with dependencies only.
import { build } from 'esbuild';
import { gitText } from '../src/defaults/git.mjs';
import { CLI_ENTRIES, entryExports } from './cli-entries.mjs';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCAL_LOADERS, dashboardScriptAsText } from './bundle.mjs';
import { checkCliDispatch } from './check-cli-dispatch.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist');
const src = (path) => JSON.stringify(join(ROOT, path));
checkCliDispatch(readFileSync(join(ROOT, 'cli/baton.mjs'), 'utf8'));

/** Each on-demand bundler cli/baton.mjs imports, as the module it would have bundled. */
const PREBUILT = {
  ...Object.fromEntries(Object.keys(CLI_ENTRIES).map((name) => [name,
    `export * as default from ${JSON.stringify(`${name}:namespace`)};`,
  ])),
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
    b.onResolve({ filter: /^[\w.-]+:namespace$/, namespace: 'prebuilt' }, ({ path }) => ({ path: path.slice(0, -10), namespace: 'prebuilt-namespace' }));
    b.onLoad({ filter: /.*/, namespace: 'prebuilt-namespace' }, ({ path }) => ({
      contents: entryExports(CLI_ENTRIES[path]),
      resolveDir: ROOT,
    }));
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
  plugins: [prebuilt, dashboardScriptAsText],
  logLevel: 'warning',
});
// The runner spawns its leg process by path (src/runner/claimRun.ts LEG_PROCESS), beside the bundle.
copyFileSync(join(ROOT, 'src/runner/legProcess.mjs'), join(OUT, 'legProcess.mjs'));
copyFileSync(join(ROOT, 'src/runner/legClient.mjs'), join(OUT, 'legClient.mjs'));
copyFileSync(join(ROOT, 'src/runner/legClient.d.mts'), join(OUT, 'legClient.d.mts'));

// What `baton repo init` writes, prebuilt (a package has no src/ and no esbuild), and the commit
// it was built from, which the package names as its courses' source and its workflow's pin
// (src/defaults/cli.ts cliPin). A modified tree is recorded as such, and that package pins nothing.
const git = (...args) => gitText(ROOT, ...args);
const { prebuildDefaults, remoteSlug } = (await import('./baton-cli.mjs')).default;
const repository = process.env.GITHUB_REPOSITORY ?? remoteSlug(ROOT);
if (!repository) throw new Error('build-cli: no origin remote names the repository the package is built from');
const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
const files = await prebuildDefaults(OUT, { repository, commit: git('rev-parse', 'HEAD'), ...(dirty ? { dirty: true } : {}) });
process.stderr.write(`build-cli: dist/baton.mjs and ${files} prebuilt defaults, ${repository}@${git('rev-parse', '--short', 'HEAD')}${dirty ? ' (modified tree)' : ''}\n`);
