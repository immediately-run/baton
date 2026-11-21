// B-68's migration 0061 (BATON_SPEC §8.1 R-BTN-3/R-BTN-14, §13.3) on a database whose credentials
// are in use. It rebuilds `credentials` for its CHECK while foreign-key checks are deferred. A
// DROP of a parent that live rows name counts each of them as a deferred violation, and the
// rename that brings the parent back never takes those counts off: the commit fails. On a
// Durable Object that failure resets the object, so 0061 — and every migration after it — never
// applies and every request is refused (2026-11-19, `baton.immediately.run`). The rows are kept
// by moving them aside and inserting them back into a table that is `credentials` from its
// CREATE: each insert of a parent row settles the children that name it.
//
// Three requests, as production runs them: the rewind to 0060 (foreign keys off), then the
// migrations as `BatonCore.migrate` applies them with foreign keys on, each in its own
// `transactionSync` (a savepoint in the request's transaction, judged when the request commits),
// then a read that sees only what that commit kept.
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { dropDerivedSchema } from '../lib/migrationRewind';
import { MIGRATIONS } from '../../src/migrations';

type Rows = Record<string, unknown>[];

describe('migration 0061 (B-68): the runner rename on a database with credentials in use', () => {
  it('commits with a runner and a grant naming a credential, every row and reference kept', async () => {
    const stub = env.BATON.get(env.BATON.idFromName('migrations-0061'));
    await runInDurableObject(stub, (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const tables = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const t of tables) sql.exec(`DROP TABLE IF EXISTS "${t.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 60)) sql.exec(m.sql);
    });

    await runInDurableObject(stub, (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = ON');
      expect(sql.exec('PRAGMA foreign_keys').toArray()).toEqual([{ foreign_keys: 1 }]);
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind) VALUES ('vm-a', 'vm-a', '[]', 'worker'), ('probe-1', 'probe-1', '[]', 'probe')`);
      sql.exec(`INSERT INTO workers (id, hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, tier_ceilings, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES (7, 'vm-a', 's', 'h', 'vm-a', 'opencode', 'vm', 'routine', '{}', 900000, '', 1, 1)`);
      sql.exec(`INSERT INTO worker_grants (credential_id, repository_id, granted_at, granted_by) VALUES ('vm-a', 'docs', 1, 'admin')`);
      const store = { exec: (q: string, ...p: unknown[]) => sql.exec(q, ...p) } as never;
      for (const m of MIGRATIONS.filter((x) => x.id >= 61)) {
        state.storage.transactionSync(() => {
          if (m.first) m.backfill?.(store, () => new Uint8Array(10), () => 5000);
          sql.exec(m.sql);
          if (!m.first) m.backfill?.(store, () => new Uint8Array(10), () => 5000);
        });
      }
    });

    await runInDurableObject(stub, (_o: unknown, state: DurableObjectState) => {
      const all = (q: string) => state.storage.sql.exec(q).toArray() as Rows;
      expect(all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('runners', 'workers', 'credentials_0061')`)).toEqual([{ name: 'runners' }]);
      expect(all(`SELECT id, kind FROM credentials WHERE id IN ('probe-1', 'vm-a') ORDER BY id`)).toEqual([{ id: 'probe-1', kind: 'probe' }, { id: 'vm-a', kind: 'runner' }]);
      expect(all('SELECT id, credential_id FROM runners')).toEqual([{ id: 7, credential_id: 'vm-a' }]);
      expect(all('SELECT credential_id, repository_id FROM runner_grants')).toEqual([{ credential_id: 'vm-a', repository_id: 'docs' }]);
      expect(all('PRAGMA foreign_key_check')).toEqual([]);
      // Every child still names `credentials`, never the scratch table.
      expect(all(`SELECT name FROM sqlite_master WHERE sql LIKE '%credentials_0061%'`)).toEqual([]);
      // The rebuilt table's CHECK is the new one: a `worker` credential is refused.
      expect(() => state.storage.sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind) VALUES ('x', 'x', '[]', 'worker')`)).toThrow(/CHECK/);
    });
  });
});
