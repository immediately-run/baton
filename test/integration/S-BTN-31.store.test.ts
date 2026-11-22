// S-BTN-31 (R-BTN-55): the same Store contract runs against both host adapters.
import { describe, expect, it } from 'vitest';
import { withStore } from '#host';
import { isUniqueViolation } from '../../src/core/db';

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
});
