// global-setup.ts — runs in Node before the Workers tests (R-BTN-29). It builds the fixture
// git repository, takes its shas and ancestry from real git, and checks the committed inputs
// the Worker-side tests read against their sources wherever a sibling docs checkout exists:
// the board states (test/fixtures/boards.json) and the vendored library (src/vendor/, R-BTN-37).
import type { TestProject } from 'vitest/node';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildFixtureRepo, boardStates, LABELS } from './lib/fixtureRepo.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

export default async function setup(project: TestProject) {
  const docs = resolve(process.env.DOCS_DIR ?? join(ROOT, '..', 'docs'));
  const haveDocs = existsSync(join(docs, 'scripts/factory-state.mjs'));

  const committed = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/boards.json'), 'utf8'));
  const repo = buildFixtureRepo();
  if (JSON.stringify(repo.shas) !== JSON.stringify(committed.shas)) {
    throw new Error('the fixture repository produced different shas than test/fixtures/boards.json records — run npm run fixtures');
  }
  if (haveDocs) {
    const live = await boardStates(repo, docs);
    if (JSON.stringify(live) !== JSON.stringify(committed.states)) {
      throw new Error(`test/fixtures/boards.json differs from what ${docs}'s factory-state code computes — run npm run fixtures`);
    }
  }
  const ancestry: Record<string, boolean> = {};
  for (const x of LABELS) for (const y of LABELS) ancestry[`${x}<${y}`] = repo.isAncestor(repo.shas[x as keyof typeof repo.shas], repo.shas[y as keyof typeof repo.shas]);
  // The docs-owned snapshot remains pinned byte for byte; scenario fixtures exercise the new wire shape.
  for (const snapshot of Object.values(committed.states) as { state: { items: { tier?: unknown }[] } }[]) {
    for (const item of snapshot.state.items) delete item.tier;
  }
  project.provide('board', { shas: repo.shas, states: committed.states, ancestry });

  const manifest = JSON.parse(readFileSync(join(ROOT, 'src/vendor/manifest.json'), 'utf8'));
  const vendored = Object.fromEntries(Object.keys(manifest.files).map((n) => [n, sha256(join(ROOT, 'src/vendor', n))]));
  const upstream = haveDocs ? Object.fromEntries(Object.keys(manifest.files).map((n) => [n, sha256(join(docs, 'scripts/lib', n))])) : null;
  const copiesInShared = Object.keys(manifest.files).filter((n) => existsSync(join(ROOT, 'src/shared', n)));
  project.provide('vendor', { manifest: manifest.files, vendored, upstream, copiesInShared });
  // The docs files the tests read (scripts/vendor.mjs FIXTURES), checked the same way.
  const { FIXTURES } = await import('../scripts/vendor.mjs');
  const fixtures = Object.fromEntries(Object.keys(FIXTURES).map((p) => [p, sha256(join(ROOT, p))]));
  const fixturesUpstream = haveDocs ? Object.fromEntries(Object.entries(FIXTURES as Record<string, string>).map(([p, d]) => [p, sha256(join(docs, d))])) : null;
  project.provide('fixtures', { manifest: manifest.fixtures ?? {}, vendored: fixtures, upstream: fixturesUpstream });
  project.provide('wranglerToml', readFileSync(join(ROOT, 'wrangler.toml'), 'utf8'));

  // One input from the real producer: what the docs sync would post for today's board —
  // docs' own buildPayload at its origin/main, reference data included.
  let liveBoard: Record<string, unknown> | null = null;
  if (haveDocs) {
    const { buildPayload } = await import(join(docs, 'scripts/baton-sync.mjs'));
    const { execFileSync } = await import('node:child_process');
    const sha = execFileSync('git', ['-C', docs, 'rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
    const { _state, ...payload } = buildPayload(sha, { root: docs });
    liveBoard = { ...payload, sha };
  }
  project.provide('liveBoard', liveBoard);
}
