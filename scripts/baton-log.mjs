import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = resolve(import.meta.dirname, '../.local');
mkdirSync(out, { recursive: true });
const outfile = resolve(out, `baton-log-${process.pid}.mjs`);
await build({ entryPoints: [resolve(import.meta.dirname, '../src/runner/logView.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'warning' });
export const { logRoles, terminalText, viewLog } = await import(pathToFileURL(outfile).href);
