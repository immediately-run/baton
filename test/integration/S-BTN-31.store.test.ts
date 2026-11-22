// S-BTN-31 (R-BTN-55): the same Store contract runs against both host adapters.
import { describe, expect, it } from 'vitest';
import { HOST, withStore } from '#host';
import { isUniqueViolation } from '../../src/core/db';
import { MIGRATIONS } from '../../src/migrations';

const stop = new Error('stop');
const create = 'CREATE TABLE store_conformance (id INTEGER PRIMARY KEY, note TEXT NOT NULL)';
const insert = 'INSERT INTO store_conformance (id, note) VALUES (?, ?)';
const select = 'SELECT id FROM store_conformance ORDER BY id';

describe('S-BTN-31 Store conformance', () => {
  it('rolls back a failed nested transaction without undoing the outer writes', () => withStore((store) => {
    store.script(create);
    store.transaction(() => {
      store.exec(insert, 1, 'outer');
      expect(() => store.transaction(() => {
        store.exec(insert, 2, 'inner');
        throw stop;
      })).toThrow(stop);
      store.exec(insert, 3, 'still outer');
    });
    expect(store.exec(select).toArray()).toEqual([{ id: 1 }, { id: 3 }]);
    expect(() => store.transaction(() => {
      store.transaction(() => store.exec(insert, 4, 'inner success'));
      throw stop;
    })).toThrow(stop);
    expect(store.exec(select).toArray()).toEqual([{ id: 1 }, { id: 3 }]);
  }));

  it('one returns exactly one row and refuses zero or several', () => withStore((store) => {
    expect(store.exec('SELECT 1 AS n').one()).toEqual({ n: 1 });
    expect(() => store.exec('SELECT 1 WHERE 1 = 0').one()).toThrow();
    expect(() => store.exec('SELECT 1 UNION ALL SELECT 2').one()).toThrow();
  }));

  it('reports rowsWritten for a drained RETURNING cursor and for a no-op write', () => withStore((store) => {
    store.script(create);
    const cur = store.exec(`${insert} RETURNING id`, 1, 'new');
    expect(cur.one()).toEqual({ id: 1 });
    expect(cur.rowsWritten).toBe(1);
    const noOp = store.exec('UPDATE store_conformance SET note = ? WHERE id = ?', 'missing', 2);
    expect(noOp.toArray()).toEqual([]);
    expect(noOp.rowsWritten).toBe(0);
  }));

  it('returns an integer above 2^53 as a rounded number without throwing', () => withStore((store) => {
    expect(store.exec('SELECT 9007199254740993 AS n').one()).toEqual({ n: 2 ** 53 });
  }));

  it('keeps the host write count for inserts and updates on an indexed column', () => withStore((store) => {
    store.script(`${create}; CREATE INDEX store_conformance_note ON store_conformance(note);`);
    const added = store.exec(`${insert} RETURNING id`, 1, 'new');
    expect(added.one()).toEqual({ id: 1 });
    const updated = store.exec('UPDATE store_conformance SET note = ? WHERE id = ? RETURNING note', 'updated', 1);
    expect(updated.one()).toEqual({ note: 'updated' });
    const expected = HOST === 'cloudflare' ? 2 : 1;
    expect(added.rowsWritten).toBe(expected);
    expect(updated.rowsWritten).toBe(expected);
  }));

  it('recognizes a unique violation but not a NOT NULL violation', () => withStore((store) => {
    store.script(create);
    store.exec(insert, 1, 'taken');
    for (const [id, note, unique] of [[1, 'duplicate id', true], [2, null, false]] as const) {
      let error: unknown;
      try { store.exec(insert, id, note); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(Error);
      expect(isUniqueViolation(error)).toBe(unique);
    }
  }));

  it('keeps a write when the caller throws and catches outside a Store transaction', () => withStore((store) => {
    store.script(create);
    expect(() => {
      store.exec(insert, 1, 'kept');
      throw stop;
    }).toThrow(stop);
    expect(store.exec(select).one()).toEqual({ id: 1 });
  }));

  it('preserves populated legacy tie order and view versions in migration 0076', () => withStore((store) => {
    // The preceding data backfills have nothing to do in this empty database.
    for (const m of MIGRATIONS.filter((m) => m.id < 76)) store.transaction(() => store.script(m.sql));
    store.script(`
      INSERT INTO credentials (id, hostname, allowed_capabilities, kind) VALUES ('fixture', 'fixture', '[]', 'legacy');
      INSERT INTO runners (id, hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling,
        lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
      VALUES (1, 'fixture', 'fixture', 'fixture', 'fixture', 'claude-code', 'legacy', 'critical', 0, '', 0, 0);
      INSERT INTO repositories (rowid, id, github, default_branch, sync_workflow)
      VALUES (24, 'alpha', 'fixture/alpha', 'main', 'sync.yml'), (3, 'zulu', 'fixture/zulu', 'main', 'sync.yml');
      INSERT INTO board_head (repository_id, fleet_version) VALUES ('zulu', 11);
      INSERT INTO activities (rowid, runner_id, id, kind, source, started_at, received_at)
      VALUES (24, 1, 'alpha', 'orient', 'skill', 100, 100), (3, 1, 'zulu', 'orient', 'skill', 100, 100);
      INSERT INTO instance_readings (rowid, instance, source, kind, available, observed_at, lapses_at, posted_by)
      VALUES (24, 'fixture', 'zulu', 'state', 1, 100, 999, 'zulu'), (3, 'fixture', 'alpha', 'state', 0, 100, 999, 'alpha');
      INSERT INTO runner_reports (rowid, runner_id, repository_id, key, received_at, payload)
      VALUES (24, 1, 'zulu', 'zulu', 100, '{}'), (3, 1, 'zulu', 'alpha', 100, '{}');
    `);
    const versions = () => [
      store.exec<{ fleet_version: number }>("SELECT fleet_version FROM board_head WHERE repository_id = 'zulu'").one().fleet_version,
      store.exec<{ v: number }>("SELECT CAST(value AS INTEGER) AS v FROM baton_settings WHERE key = 'instances_version'").one().v,
    ];
    const [fleet, instances] = versions();
    store.transaction(() => store.script(MIGRATIONS.find((m) => m.id === 76)!.sql));
    for (const query of [
      'SELECT id AS name FROM repositories ORDER BY insertion_order',
      'SELECT id AS name FROM activities ORDER BY started_at, insertion_order',
      'SELECT source AS name FROM instance_readings ORDER BY observed_at DESC, insertion_order DESC',
      'SELECT key AS name FROM runner_reports ORDER BY received_at DESC, insertion_order DESC',
    ]) expect(store.exec(query).toArray()).toEqual([{ name: 'zulu' }, { name: 'alpha' }]);
    expect(versions()).toEqual([fleet, instances]);
    store.exec("UPDATE runner_reports SET payload = ? WHERE key = 'zulu'", '{"new":true}');
    store.exec("UPDATE instance_readings SET available = 0 WHERE source = 'zulu'");
    expect(versions()).toEqual([fleet + 1, instances + 1]);
  }));
});
