// B-168 — the restructure's part 4 in the resources and the settings (BATON_SPEC §6.3 R-BTN-76,
// §12.8 R-BTN-181/R-BTN-188, §8.3 R-BTN-106, §13.7): two scopes and no runner `uses`; an
// administrator's reading one more instrument's; no reading signature; `required_independence`,
// `trigger_workflows` and `report_horizon_h` gone. Migration 0039's backfill logs each registration
// the migration drops as an `admin` event — a database at 0038 holding a worker-scope resource's
// implicit instance, its reading, a worker's `uses` row and an account instance's, keeps the
// account's and loses the rest with a line each.
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { MIGRATIONS } from '../../src/migrations';

const COLUMNS = (sql: SqlStorage, table: string) => (sql.exec(`SELECT name FROM pragma_table_info('${table}')`).toArray() as { name: string }[]).map((r) => r.name);

describe('migration 0039 (B-168): resources lose their worker scope, the fleet its worker counts', () => {
  it('drops a worker-scope resource and its implicit instance, logged as an admin event each', async () => {
    const id = env.BATON.idFromName('migrations-0039');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      const objects = sql.exec("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { type: string; name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 38)) sql.exec(m.sql);
      sql.exec('PRAGMA foreign_keys = ON');

      // A repository, a worker, an account resource with an instance and a worker-scope resource.
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind) VALUES ('vm-a', 'vm-a', '[]', 'worker')`);
      sql.exec(`INSERT INTO workers (id, hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, tier_ceilings, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES (7, 'vm-a', 's', 'h', 'vm-a', 'opencode', 'vm', 'routine', '{}', 900000, '', 1, 1)`);
      sql.exec(`INSERT INTO external_resources (name, scope, detail_schema, atoms_from, base_chain_json) VALUES
                ('llm:cap', 'account', '{"type":"object"}', 'any', '[]'), ('github-api', 'worker', '{"type":"object"}', 'admin', '[]')`);
      sql.exec(`INSERT INTO resource_instances (name, repositories) VALUES ('acct:cap', '["docs"]')`);
      sql.exec(`INSERT INTO instance_serves (instance, resource) VALUES ('acct:cap', 'llm:cap'), ('github-api@worker:7', 'github-api')`);
      sql.exec(`INSERT INTO instance_states (instance, state, changed_at) VALUES ('acct:cap', 'available', 1), ('github-api@worker:7', 'unavailable', 1)`);
      sql.exec(`INSERT INTO instance_readings (instance, source, kind, available, observed_at, lapses_at, posted_by, writer, nonce, signature) VALUES
                ('acct:cap', 'worker:7', 'state', 1, 1, 9, 'worker:7', 'runner', 'n', 's'),
                ('github-api@worker:7', 'worker:7', 'state', 0, 1, 9, 'worker:7', 'runner', 'n', 's')`);
      sql.exec(`INSERT INTO worker_instances (worker_id, instance) VALUES (7, 'acct:cap'), (7, 'github-api@worker:7')`);
      sql.exec(`INSERT INTO resource_fleet (repository_id, resource, usable_workers, open_workers) VALUES ('docs', 'llm:cap', 1, 0)`);
      sql.exec(`INSERT INTO events (at, kind, actor) VALUES (1, 'claimed', 'worker:7')`);

      // As `BatonCore.migrate` runs it: the backfill first, reading the rows, then the SQL.
      const m39 = MIGRATIONS.find((x) => x.id === 39)!;
      m39.backfill!({ exec: (q: string, ...p: unknown[]) => sql.exec(q, ...p) } as never, () => new Uint8Array(10), () => 5000);
      sql.exec(m39.sql);

      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      // The worker-scope resource and everything its implicit instance held are gone.
      expect(all(`SELECT name, scope FROM external_resources ORDER BY name`)).toEqual([{ name: 'llm:cap', scope: 'account' }]);
      expect(all(`SELECT instance, resource FROM instance_serves`)).toEqual([{ instance: 'acct:cap', resource: 'llm:cap' }]);
      expect(all(`SELECT instance, state FROM instance_states`)).toEqual([{ instance: 'acct:cap', state: 'available' }]);
      expect(all(`SELECT instance, source FROM instance_readings`)).toEqual([{ instance: 'acct:cap', source: 'worker:7' }]);
      // Each dropped registration is logged once, as an admin event naming what it was.
      expect(all(`SELECT at, kind, actor, detail_json FROM events WHERE kind = 'admin' ORDER BY seq`)).toEqual([
        { at: 5000, kind: 'admin', actor: 'migration:0039', detail_json: JSON.stringify({ act: 'resource-dropped', kind: 'instance', name: 'github-api@worker:7' }) },
        { at: 5000, kind: 'admin', actor: 'migration:0039', detail_json: JSON.stringify({ act: 'resource-dropped', kind: 'resource', name: 'github-api' }) },
      ]);
      // The fleet's row keeps its counts under the new names; the old columns and the reading's
      // signature are gone; the log takes `deprecated-field`.
      expect(all(`SELECT * FROM resource_fleet`)).toEqual([{ repository_id: 'docs', resource: 'llm:cap', usable_instances: 1, open_instances: 0, live_runner: 0 }]);
      expect(COLUMNS(sql, 'external_resources')).toEqual(['name', 'scope', 'detail_schema', 'base_chain_json']);
      expect(COLUMNS(sql, 'instance_readings')).not.toContain('nonce');
      expect(COLUMNS(sql, 'instance_readings')).not.toContain('signature');
      // The log's earlier rows are kept, its indexes restored beside it, and the window's kind is taken.
      expect(all(`SELECT kind FROM events WHERE seq = 1`)).toEqual([{ kind: 'claimed' }]);
      sql.exec(`INSERT INTO events (at, kind, actor, detail_json) VALUES (2, 'deprecated-field', 'heartbeat', '{"field":"heartbeat.uses"}')`);
      const names = (sql.exec("SELECT name FROM sqlite_master WHERE type = 'index'").toArray() as { name: string }[]).map((r) => r.name);
      for (const index of ['events_by_ticket', 'events_by_claim', 'events_by_repository', 'events_discrepancies', 'readings_lapse', 'serves_by_resource']) expect(names).toContain(index);
    });
  });
});
