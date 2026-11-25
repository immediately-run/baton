// Build the fixture git history in Node before the Workers and local tests (R-BTN-29).
import type { TestProject } from 'vitest/node';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildFixtureRepo } from './lib/fixtureRepo.mjs';

const ROOT = resolve(import.meta.dirname, '..');

export default function setup(project: TestProject) {
  const committed = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/boards.json'), 'utf8'));
  const repo = buildFixtureRepo();
  try {
    if (JSON.stringify(repo.shas) !== JSON.stringify(committed.shas)) {
      throw new Error('the fixture repository differs from the history recorded in test/fixtures/boards.json');
    }
    const ancestry: Record<string, boolean> = {};
    for (const [x, a] of Object.entries(repo.shas)) {
      for (const [y, b] of Object.entries(repo.shas)) ancestry[`${x}<${y}`] = repo.isAncestor(a, b);
    }
    // B-322: tiers are retired; the recorded snapshots keep theirs, the wire carries none.
    for (const snapshot of Object.values(committed.states) as { state: { items: { tier?: unknown }[] } }[]) {
      for (const item of snapshot.state.items) delete item.tier;
    }
    project.provide('board', { shas: repo.shas, states: committed.states, ancestry });
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
  project.provide('wranglerToml', readFileSync(join(ROOT, 'wrangler.toml'), 'utf8'));
}
