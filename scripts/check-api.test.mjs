import { describe, expect, it } from 'vitest';
import { comparisonProblems, migratedTables, specifiedRoutes, specifiedTables } from './check-api.mjs';
import { legacyRoutes } from './lib/core-routes.mjs';

// B-277 exercises the repository verification under R-BTN-31, not a runtime API change.
describe('check:api', () => {
  it('compares methods and path shapes, including abbreviated routes and regex alternatives', () => {
    const spec = '| `POST /v1/ui/claims/{id}/confirm`, `…/release` | session |';
    const core = `class Fixture {
      runnerRoute(req, url) {
        const p = url.pathname, m = req.method;
        // if (m === 'POST' && p === '/v1/ui/in-a-comment') return json({});
        if (p.startsWith('/v1/ui/') && m === 'POST') {
          const hit = /^\\/v1\\/ui\\/claims\\/(\\d+)\\/(confirm|release)$/.exec(p);
          if (hit) return json({});
        }
      }
    }`;
    const built = legacyRoutes(core);
    expect([...built]).toEqual(['POST /v1/ui/claims/{}/confirm', 'POST /v1/ui/claims/{}/release']);
    expect(specifiedRoutes(spec)).toEqual(built);
    expect(comparisonProblems('route', specifiedRoutes(spec), legacyRoutes(core.replace("&& m === 'POST'", "&& m === 'PUT'")), {
      specifiedOnly: {}, builtOnly: {},
    })).toEqual([
      'route specified but not built: POST /v1/ui/claims/{}/confirm',
      'route specified but not built: POST /v1/ui/claims/{}/release',
      'route built but not specified: PUT /v1/ui/claims/{}/confirm',
      'route built but not specified: PUT /v1/ui/claims/{}/release',
    ]);
  });

  it('checks the final migrated table names and rejects stale exceptions', () => {
    const spec = '| Table | Key |\n|---|---|\n| `renamed` | id |\n\n| Setting | Default |\n| `not_a_table` | null |';
    const built = migratedTables([
      { sql: 'CREATE TABLE old (id INTEGER PRIMARY KEY AUTOINCREMENT); CREATE TABLE dropped (id INTEGER)' },
      { sql: 'DROP TABLE dropped; ALTER TABLE old RENAME TO renamed' },
    ]);
    expect([...built]).toEqual(['renamed']);
    expect(comparisonProblems('table', specifiedTables(spec), built, { specifiedOnly: { renamed: 'B-277' }, builtOnly: {} }))
      .toEqual(['table specified but not built: remove stale exception renamed']);
  });
});
