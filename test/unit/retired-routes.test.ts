// retired-routes.test.ts — B-203's source check (BATON_SPEC §11.3 R-BTN-129; S-BTN-306 is the
// served half): nothing under `src/` references the two routes the cutover retired —
// `GET /v1/ui/state` and `POST /v1/ui/claims/{id}/resolve` — nor the name the state's function
// had, and the administrator route keeps no `GET` branch for a path the reads dispatcher
// answers. Node only: it reads the checkout.
//
// Two trees are left out, each for its own reason: `src/migrations/` is append-only history
// (CLAUDE.md) — 0049 and 0055 name the retired read in the comment that explains an index, and
// a migration is never edited; `src/dashboard/dist/` is the bundle `npm run build:ui` writes
// from the sources this test reads.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const SRC = join(ROOT, 'src');
const LEFT_OUT = [join(SRC, 'migrations'), join(SRC, 'dashboard', 'dist')];

function files(dir: string): string[] {
  if (LEFT_OUT.includes(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** The retired spellings: the state's route; V1's completion route with its id written as a
 *  parameter, a pattern or a template; and the function's old name. */
const RETIRED: [string, RegExp][] = [
  ['GET /v1/ui/state', /\/v1\/ui\/state\b/],
  ['POST /v1/ui/claims/{id}/resolve', /ui\/claims\/[^\s'"`]{1,40}\/resolve\b/],
  ['POST /v1/ui/claims/{id}/resolve, as the router matched it', /claims\\\/\(\\d\+\)\\\/resolve/],
  ['uiState()', /\buiState\b/],
];

describe('B-203: the retired routes are named nowhere under src/', () => {
  const sources = files(SRC);

  it('reads the source tree', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some((p) => p.endsWith(join('core', 'baton.ts')))).toBe(true);
    expect(sources.some((p) => p.includes(join('src', 'dashboard', 'screens')))).toBe(true);
  });

  it.each(RETIRED)('%s', (_what, pattern) => {
    const hits = sources.flatMap((path) => readFileSync(path, 'utf8').split('\n')
      .map((line, i) => (pattern.test(line) ? `${relative(ROOT, path)}:${i + 1}: ${line.trim().slice(0, 120)}` : null))
      .filter((x): x is string => x !== null));
    expect(hits).toEqual([]);
  });

  it('the patterns find what they are for', () => {
    expect(RETIRED[0][1].test("if (url.pathname === '/v1/ui/state') {")).toBe(true);
    expect(RETIRED[1][1].test('`POST /v1/ui/claims/{id}/resolve` (§6.7)')).toBe(true);
    expect(RETIRED[1][1].test('owner(`/v1/ui/claims/${id}/resolve`, body)')).toBe(true);
    expect(RETIRED[2][1].test(String.raw`const resolve = /^\/v1\/ui\/claims\/(\d+)\/resolve$/.exec(p);`)).toBe(true);
    // The routes that stay are not caught.
    expect(RETIRED[1][1].test('/v1/ui/scope/{finding}/resolve')).toBe(false);
    expect(RETIRED[1][1].test('/v1/ui/claims/{claim}/release')).toBe(false);
    expect(RETIRED[0][1].test('/v1/admin/state')).toBe(false);
  });

  it('the administrator route has no GET branch for the registry or the capacities: the reads dispatcher answers them', () => {
    const core = readFileSync(join(SRC, 'core', 'routes', 'admin.ts'), 'utf8');
    expect(core).not.toMatch(/m === 'GET' && p === '\/v1\/admin\/(repositories|capacities)'/);
    // Their writes, and the state's read, are the route's still.
    expect(core).toMatch(/m === 'POST' && p === '\/v1\/admin\/repositories'/);
    expect(core).toMatch(/m === 'PUT' && p === '\/v1\/admin\/capacities'/);
    expect(core).toMatch(/m === 'GET' && p === '\/v1\/admin\/state'\) return json\(stateView\(core\)\)/);
  });
});
