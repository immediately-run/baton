#!/usr/bin/env node
// check-actions.mjs — `npm run check:actions` (B-204; BATON_SPEC §11.3 R-BTN-129): the action
// table of src/core/actions.ts against the screen table of src/core/screens.ts. Fails when a
// `ui.view` names no screen, when a `view` stands on an entry whose callers list no session,
// when an id breaks the grammar or is listed twice; lists, never failing, every screen no
// control names. The rules themselves are `checkActions` in src/core/actions.ts — one
// function, which the unit test drives with failing fixtures; this is its command line.
// `--json <file>` checks a table read from a file instead (the test's fixtures).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A TypeScript module of src/core, bundled in memory and imported: both are pure data. */
async function load(file) {
  const out = await build({ entryPoints: [resolve(root, file)], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

export async function run(argv = process.argv.slice(2), log = console.log) {
  const actions = await load('src/core/actions.ts');
  const { SCREENS } = await load('src/core/screens.ts');
  const at = argv.indexOf('--json');
  const table = at >= 0 ? JSON.parse(readFileSync(resolve(argv[at + 1]), 'utf8')) : actions.ACTIONS;
  const { errors, uncontrolled } = actions.checkActions(table, SCREENS.map((s) => s.id));
  for (const e of errors) log(`check:actions: ${e}`);
  log(`check:actions: ${table.length} actions, ${table.filter((a) => a.ui).length} with a view; ${errors.length} error${errors.length === 1 ? '' : 's'}`);
  if (uncontrolled.length) log(`check:actions: screens with no control (${uncontrolled.length}): ${uncontrolled.join(', ')}`);
  return errors.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await run());
