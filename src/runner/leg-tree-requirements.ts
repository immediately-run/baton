import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { graphOf } from '../core/graph';
import { dependencyInputs } from './leg-dependencies';
import { LEG_TREES, legScripts } from './leg-scripts';

/** Sync and kit agree on which scripts require a leg-trees runner. Neither loads the module. */
export async function checkLegTreeRequirements(root: string, course: string, graph: unknown, sourced = false): Promise<void> {
  const baton = join(root, '.baton');
  const dir = join(baton, 'courses', course);
  const legs = join(dir, 'legs');
  const scripts = legScripts((await readdir(legs, { withFileTypes: true }).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  })).filter((e) => e.isFile() || e.isSymbolicLink()).map((e) => e.name));
  const homeDeps = await dependencyInputs(baton);
  const courseDeps = await dependencyInputs(dir);
  for (const [name, leg] of graphOf(graph).legs) {
    if (leg.person) continue;
    const required = leg.requires.filter((c) => c.startsWith('runner:'));
    const unknown = required.find((c) => c !== LEG_TREES);
    if (unknown) throw new Error(`${course}/${name}: unknown runner capability ${unknown} (R-BTN-133)`);
    const file = scripts.get(name);
    const importsKit = file && (await readFile(join(legs, file), 'utf8')).includes('@immediately-run/baton/leg');
    if ((sourced || homeDeps || courseDeps || (file && !file.endsWith('.mjs')) || importsKit) && !required.includes(LEG_TREES)) {
      throw new Error(`${course}/${name}: requires ${LEG_TREES} (R-BTN-133)`);
    }
  }
}
