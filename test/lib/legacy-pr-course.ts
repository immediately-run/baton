import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** These scenarios exercise snapshot placement on a repository that has not adopted B-311. */
export function keepLegacyPrPlacement(root: string, id = 'create-pr') {
  const settings = join(root, '.baton', 'baton.json');
  const config = JSON.parse(readFileSync(settings, 'utf8'));
  const entry = config.courses.find((row: { id: string }) => row.id === id);
  if (!entry) throw new Error(`missing fixture course ${id}`);
  delete entry.source;
  entry.version = 1;
  entry.min_runner_version = 1;
  const file = join(root, '.baton', 'courses', id, 'course.json');
  const graph = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, leg] of Object.entries(graph.legs as Record<string, { arrives?: unknown; reconciles?: unknown }>)) {
    if (leg.arrives || leg.reconciles) delete graph.legs[name];
  }
  entry.step_kinds = Object.keys(graph.legs);
  writeFileSync(settings, JSON.stringify(config, null, 2));
  writeFileSync(file, JSON.stringify(graph, null, 2));
}
