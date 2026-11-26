import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { comparisonProblems, migratedTables, registeredReadRoutes, specifiedRoutes, specifiedTables } from './check-api.mjs';
import { openTickets } from './lib/check-exceptions.mjs';
import { legacyRoutes, readMethods } from './lib/core-routes.mjs';

// B-277 exercises the repository verification under R-BTN-31, not a runtime API change.
describe('check:api', () => {
  it.each(['', '  '])('accepts padded and unpadded Markdown cells (%j)', (pad) => {
    const table = `|${pad}Table${pad}| Key |\n|---|---|\n|${pad}\`widgets\`${pad}| id |`;
    expect([...specifiedTables(table)]).toEqual(['widgets']);
    expect([...specifiedRoutes(`|${pad}\`GET/HEAD /v1/widgets\`${pad}| reader |`)]).toEqual([
      'GET /v1/widgets', 'HEAD /v1/widgets',
    ]);
  });

  it('expands the methods admitted by the registered read dispatcher', () => {
    const guard = (predicate) => `export function dispatchRead(cx, req, url) { if (${predicate}) return null; }`;
    const actions = [
      { id: 'widget.read', http: { method: 'GET', path: '/v1/widgets/{widget}' } },
      { id: 'unserved.read', http: { method: 'GET', path: '/v1/unserved' } },
    ];
    const reads = [{ action: 'widget.read' }];
    expect(registeredReadRoutes(actions, reads, readMethods(guard("req.method !== 'GET' && req.method !== 'HEAD'"))))
      .toEqual(['GET /v1/widgets/{}', 'HEAD /v1/widgets/{}']);
    expect(registeredReadRoutes(actions, reads, readMethods(guard("req.method !== 'GET'"))))
      .toEqual(['GET /v1/widgets/{}']);
    expect(() => readMethods(guard("req.method !== 'GET' || req.method !== 'HEAD'"))).toThrow(/unsupported/);
  });

  it('keeps both legacy method alternatives and rejects correlated path/method branches', () => {
    const router = (guard) => `class Fixture { route(req, url) { if (${guard}) return json({}); } }`;
    expect([...legacyRoutes(router("(req.method === 'PUT' || req.method === 'POST') && url.pathname === '/v1/widgets'"))])
      .toEqual(['PUT /v1/widgets', 'POST /v1/widgets']);
    expect(() => legacyRoutes(router("(req.method === 'PUT' && url.pathname === '/v1/widgets') || (req.method === 'POST' && url.pathname === '/v1/items')")))
      .toThrow(/unsupported route method alternatives/);
  });

  it('rejects matching new exceptions in both directions and validates ticket ids', () => {
    expect(comparisonProblems('route', new Set(['GET /v1/spec']), new Set(['GET /v1/core']), {
      specifiedOnly: { 'GET /v1/spec': 'B-277' }, builtOnly: { 'GET /v1/core': null },
    }, { specifiedOnly: {}, builtOnly: {} })).toEqual([
      'route specified but not built: new exception GET /v1/spec; the list may only shrink',
      'route built but not specified: invalid ticket for exception GET /v1/core',
      'route built but not specified: new exception GET /v1/core; the list may only shrink',
    ]);
  });

  it('admits a new exception only when it names an open ticket (owner ruling 2026-11-26)', () => {
    const open = new Set(['B-338']);
    const prior = { specifiedOnly: {}, builtOnly: {} };
    const check = (ticket) => comparisonProblems('route', new Set(['GET /v1/spec']), new Set(), {
      specifiedOnly: { 'GET /v1/spec': ticket }, builtOnly: {},
    }, prior, open);
    expect(check('B-338')).toEqual([]);
    expect(check('B-1')).toEqual(['route specified but not built: new exception GET /v1/spec; B-1 is not an open ticket in tickets/']);
    expect(check(null)).toEqual([
      'route specified but not built: invalid ticket for exception GET /v1/spec',
      'route specified but not built: new exception GET /v1/spec; a new entry names the open ticket that builds it',
    ]);
  });

  it('reads open tickets from tickets/, not tickets/archive/, and not done, superseded or withdrawn', () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-open-tickets-'));
    try {
      mkdirSync(join(root, 'tickets/archive'), { recursive: true });
      const ticket = (path, status) => writeFileSync(join(root, path), `---\ntitle: "x"\nstatus: ${status}\n---\nBody status: done\n`);
      ticket('tickets/B-1.mdx', 'available');
      ticket('tickets/B-2.mdx', 'in-review');
      ticket('tickets/B-3.mdx', 'done');
      ticket('tickets/B-4.mdx', 'superseded');
      ticket('tickets/B-5.mdx', 'withdrawn');
      ticket('tickets/archive/B-6.mdx', 'available');
      expect(openTickets(root)).toEqual(new Set(['B-1', 'B-2']));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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
