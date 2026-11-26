// Checkout-only builder; the published package substitutes the same entry exports at build time.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLI_ENTRIES, entryExports } from './cli-entries.mjs';

const root = resolve(import.meta.dirname, '..');

export async function bundleCommand(name, { legProcess = false } = {}) {
  // Files are per process, so two checkout invocations cannot rewrite each other's bundle.
  // Keep them directly under .local for packageVersion(), and the leg process beside them.
  const dir = join(root, '.local');
  mkdirSync(dir, { recursive: true });
  const outfile = join(dir, `${name.slice(0, -4)}-${process.pid}.mjs`);
  try {
    if (legProcess) {
      copyFileSync(join(root, 'src/runner/legProcess.mjs'), join(dir, 'legProcess.mjs'));
      // legProcess.mjs imports its client beside it (src/runner/legClient.mjs, B-55).
      copyFileSync(join(root, 'src/runner/legClient.mjs'), join(dir, 'legClient.mjs'));
    }
    await build({
      stdin: { contents: entryExports(CLI_ENTRIES[name]), resolveDir: root },
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      packages: 'external',
      loader: { '.json': 'json', '.txt': 'text' },
      logLevel: 'warning',
    });
    return await import(pathToFileURL(outfile).href);
  } catch (e) {
    throw new Error(`${name} did not load: ${e?.message ?? e}`, { cause: e });
  } finally {
    rmSync(outfile, { force: true });
  }
}
