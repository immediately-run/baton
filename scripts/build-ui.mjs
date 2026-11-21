#!/usr/bin/env node
// build-ui.mjs — the dashboard's one bundle (BATON-UI-V2, B-193): esbuild builds src/dashboard
// into src/dashboard/dist/ — app.js (one IIFE, minified, the current Chrome, Firefox and Safari,
// JSX automatic) and app.css, from the stylesheet main.tsx imports — and copies index.html
// beside them. The three files are text the Worker and the local host embed (wrangler.toml's
// Text rule, scripts/bundle.mjs) and the published CLI embeds too (scripts/build-cli.mjs),
// exactly as V1's were. dist/ is gitignored, so every path that needs it builds first: pretest,
// pretest:baton, pretest:no-quint, pretypecheck, predev, prestart:local, prebuild:cli — and
// baton-deploy.yml runs it before `wrangler deploy`.
//
// Every pre* hook above runs through here, so this is also where an incomplete node_modules is
// repaired before anything needs it. The environment this repository's tests run in restores a
// stale node_modules around the test gate (B-193's three red gates: the shared tree predating
// the PR's lockfile, then twice re-extracted to a 281-package image that lacks react-dom, jsdom
// and @testing-library/react minutes after a leg had installed the lockfile in full) — a fault
// no leg can outinstall, because it reappears after the leg exits. So build:ui, before it
// builds, checks that node_modules holds what package-lock.json locks for package.json's own
// dependencies and devDependencies, and when it does not, installs the lockfile itself —
// `npm ci --ignore-scripts`, the one install B-132 allows, which rewrites node_modules and
// never the lockfile. On a clean checkout (`npm ci && npm test`) the check passes and nothing
// is installed; the heal is for the tree that arrives stale.
import { spawnSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src', 'dashboard');
const OUT = join(SRC, 'dist');

const require = createRequire(import.meta.url);

// The root of the check: package.json's own dependencies and devDependencies, each present at
// exactly its locked version. A node_modules written by npm from this lockfile holds them all;
// one restored from any older lockfile — the gate's stale image — misses the new (react,
// react-dom, jsdom, @testing-library/react) and differs on the old (vitest, typescript), so the
// check fires. Root entries carry no os/cpu gates, so nothing here re-derives what npm may
// legitimately skip deeper in the tree.
const staleNodeModules = () => {
  let pkg;
  let lock;
  try {
    pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  } catch {
    return []; // no readable package.json or lockfile: nothing to check against
  }
  const stale = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      const locked = lock.packages?.[`node_modules/${name}`]?.version;
      let installed;
      try {
        installed = JSON.parse(readFileSync(join(ROOT, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')).version;
      } catch {
        installed = null;
      }
      if (!locked || installed !== locked) stale.push(`${name}@${locked ?? '?'}`);
    }
  }
  // The bundle's one bare import is 'react-dom/client' (main.tsx); everything else is this
  // repository. When it does not resolve, node_modules is incomplete — a stale or half-installed
  // tree, not a source fault — so say that instead of letting esbuild's "Could not resolve"
  // stack trace stand in for a diagnosis (B-132 installs with `npm ci --ignore-scripts`).
  try {
    require.resolve('react-dom/client');
  } catch {
    stale.push("'react-dom/client' (unresolvable)");
  }
  return stale;
};

// Repair a stale node_modules from the lockfile (B-132: `npm ci --ignore-scripts` — the
// environment restores a stale tree after every leg; see the header). Bounded, because a hung
// install must not hold the test that runs it.
const installFromLockfile = () => {
  // The run-tests worktree may borrow the home checkout's node_modules via a symlink.
  // npm ci clears directory entries through that link before replacing it. Unlink first
  // so the install belongs to the worktree and cannot empty the home checkout's tree.
  const modules = join(ROOT, 'node_modules');
  if (lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(modules);
  const run = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 10 * 60_000,
    killSignal: 'SIGKILL',
  });
  return run.status === 0 && !run.signal;
};

const stale = staleNodeModules();
if (stale.length > 0) {
  const head = stale.slice(0, 4).join(', ');
  console.error(
    `build:ui: node_modules does not satisfy package-lock.json (${head}${stale.length > 4 ? `, … ${stale.length - 4} more` : ''}) — installing the lockfile (npm ci --ignore-scripts, B-132).`,
  );
  if (!installFromLockfile()) {
    console.error('build:ui: the lockfile install did not complete — see npm above.');
    process.exit(1);
  }
  const still = staleNodeModules();
  if (still.length > 0) {
    console.error(
      `build:ui: node_modules still does not satisfy package-lock.json after npm ci (${still.slice(0, 4).join(', ')}) — install it by hand: npm ci --ignore-scripts (B-132).`,
    );
    process.exit(1);
  }
}
const { build } = await import('esbuild');

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
