#!/usr/bin/env node
// B-277: compare method/path shapes and table names (not contracts or columns).
// scripts/check-api-exceptions.json lists each discrepancy against the ticket that resolves it
// (`"POST /v1/widgets": "B-338"`). The lists are exact, and only shrink against the default
// branch, except that a new entry may name an open ticket that builds it — a file in tickets/,
// not tickets/archive/, whose status is not done, superseded or withdrawn (owner ruling
// 2026-11-26, BATON_SPEC §90). Remove the entry when that ticket's code lands.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { LOCAL_LOADERS } from './bundle.mjs';
import { exceptionProblems, openTickets, priorExceptions } from './lib/check-exceptions.mjs';
import { legacyRoutes, readMethods, routeKey } from './lib/core-routes.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

async function load(entry) {
  const out = await build({ entryPoints: [resolve(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', loader: LOCAL_LOADERS, write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

export function specifiedRoutes(text) {
  return new Set(firstCells(text).flatMap((cell) => {
    if (!cell || !/^`[^`]+`(?:\s*,\s*`[^`]+`)*$/.test(cell)) return [];
    const [first, ...aliases] = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const route = /^(\w+(?:\/\w+)*)\s+(\/v1\/\S+)$/.exec(first);
    if (!route) return [];
    const [, methods, path] = route;
    const paths = [path, ...aliases.map((alias) => {
      if (!alias.startsWith('…/')) throw new Error(`unsupported route alias: ${alias}`);
      return path.slice(0, path.lastIndexOf('/')) + alias.slice(1);
    })];
    return methods.split('/').flatMap((method) => paths.map((path) => routeKey(method, path)));
  }));
}

function firstCells(text) {
  return text.split(/\r?\n/).map((line) => /^ {0,3}\|([^|]*)\|/.exec(line)?.[1].trim() ?? null);
}

export function specifiedTables(text) {
  const tables = new Set();
  let inTable = false;
  for (const cell of firstCells(text)) {
    if (cell === null) inTable = false;
    if (cell === 'Table') inTable = true;
    const row = /^`(\w+)`$/.exec(cell ?? '');
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

export function comparisonProblems(label, specified, built, exceptions, prior, open) {
  const only = (left, right) => [...left].filter((entry) => !right.has(entry));
  return [
    ...exceptionProblems(`${label} specified but not built`, only(specified, built), exceptions.specifiedOnly, prior?.specifiedOnly, open),
    ...exceptionProblems(`${label} built but not specified`, only(built, specified), exceptions.builtOnly, prior?.builtOnly, open),
  ];
}

export function registeredReadRoutes(actions, reads, methods) {
  const implemented = new Set(reads.map(({ action }) => action));
  return actions.filter(({ id, http }) => implemented.has(id) && http.method === 'GET')
    .flatMap(({ http: { path } }) => methods.map((method) => routeKey(method, path)));
}

async function run() {
  const [{ ACTIONS }, { READS }, { MIGRATIONS }] = await Promise.all([
    load('src/core/actions.ts'), load('src/core/reads/index.ts'), load('src/migrations/index.ts'),
  ]);
  // B-272: the dispatchers moved out of baton.ts into src/core/routes/; each file is read alone.
  const routeFiles = ['src/core/baton.ts', ...readdirSync(resolve(ROOT, 'src/core/routes')).filter((f) => f.endsWith('.ts')).sort().map((f) => `src/core/routes/${f}`)];
  const routes = new Set(routeFiles.flatMap((path) => [...legacyRoutes(read(path))]));
  for (const route of registeredReadRoutes(ACTIONS, READS, readMethods(read('src/core/reads/index.ts')))) routes.add(route);
  // operatorRoute takes its paths from matchActions, including the session and owner aliases.
  for (const action of ACTIONS.filter((a) => a.http.method === 'POST' && a.ui?.route)) {
    for (const route of [action.http, action.ui.route, action.ownerHttp].filter(Boolean)) routes.add(routeKey(route.method, route.path));
  }
  const tables = migratedTables(MIGRATIONS);
  const specRoutes = specifiedRoutes(read('spec/BATON_SPEC/14-api.md'));
  const specTables = specifiedTables(read('spec/BATON_SPEC/13-data-model.md'));
  const file = 'scripts/check-api-exceptions.json';
  const exceptions = JSON.parse(read(file));
  const prior = priorExceptions(ROOT, file);
  const open = openTickets(ROOT);
  const problems = [
    ...comparisonProblems('route', specRoutes, routes, exceptions.routes, prior.routes, open),
    ...comparisonProblems('table', specTables, tables, exceptions.tables, prior.tables, open),
  ];
  for (const problem of problems) console.error(`check:api: ${problem}`);
  if (problems.length) return 1;
  console.log(`check:api OK — ${routes.size} core routes and ${tables.size} migrated tables compared with §14 and §13`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await run();
