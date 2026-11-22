#!/usr/bin/env node
// B-277: compare method/path shapes and table names (not contracts or columns).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { LOCAL_LOADERS } from './bundle.mjs';
import { exceptionProblems } from './lib/check-exceptions.mjs';
import { legacyRoutes, routeKey } from './lib/core-routes.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

async function load(entry) {
  const out = await build({ entryPoints: [resolve(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', loader: LOCAL_LOADERS, write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

export function specifiedRoutes(text) {
  return new Set([...text.matchAll(/^\| ((?:`[^`]+`(?:, )?)+) \|/gm)].flatMap(([, cell]) => {
    const [first, ...aliases] = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const route = /^(\w+) (\/v1\/\S+)$/.exec(first);
    if (!route) return [];
    const [, method, path] = route;
    return [routeKey(method, path), ...aliases.map((alias) => {
      if (!alias.startsWith('…/')) throw new Error(`unsupported route alias: ${alias}`);
      return routeKey(method, path.slice(0, path.lastIndexOf('/')) + alias.slice(1));
    })];
  }));
}

export function specifiedTables(text) {
  const tables = new Set();
  let inTable = false;
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) inTable = false;
    if (line.startsWith('| Table |')) inTable = true;
    const row = /^\| `([\w]+)` \|/.exec(line);
    if (inTable && row) tables.add(row[1]);
  }
  return tables;
}

export function migratedTables(migrations) {
  const db = new DatabaseSync(':memory:');
  try {
    // The backfills move data, not schema. Apply the registered SQL in its actual order.
    for (const { sql } of migrations) db.exec(sql);
    return new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*'").all().map(({ name }) => name));
  } finally {
    db.close();
  }
}

export function comparisonProblems(label, specified, built, exceptions) {
  const only = (left, right) => [...left].filter((entry) => !right.has(entry));
  return [
    ...exceptionProblems(`${label} specified but not built`, only(specified, built), exceptions.specifiedOnly),
    ...exceptionProblems(`${label} built but not specified`, only(built, specified), exceptions.builtOnly),
  ];
}

async function run() {
  const [{ ACTIONS }, { READS }, { MIGRATIONS }] = await Promise.all([
    load('src/core/actions.ts'), load('src/core/reads/index.ts'), load('src/migrations/index.ts'),
  ]);
  const implemented = new Set(READS.map(({ action }) => action));
  const routes = legacyRoutes(read('src/core/baton.ts'));
  for (const { id, http: { method, path } } of ACTIONS) {
    if (implemented.has(id)) routes.add(routeKey(method, path));
  }
  const tables = migratedTables(MIGRATIONS);
  const specRoutes = specifiedRoutes(read('spec/BATON_SPEC/14-api.md'));
  const specTables = specifiedTables(read('spec/BATON_SPEC/13-data-model.md'));
  const baseline = JSON.parse(read('scripts/check-api-exceptions.json'));
  const problems = [
    ...comparisonProblems('route', specRoutes, routes, baseline.routes),
    ...comparisonProblems('table', specTables, tables, baseline.tables),
  ];
  for (const problem of problems) console.error(`check:api: ${problem}`);
  if (problems.length) return 1;
  console.log(`check:api OK — ${routes.size} core routes and ${tables.size} migrated tables compared with §14 and §13`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await run();
