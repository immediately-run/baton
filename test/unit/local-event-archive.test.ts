import { appendFile, chmod, link, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { fileEventArchive } from '../../src/local/eventArchive';
import { openStore } from '../../src/local/store';

const part = { repository: 'baton', day: '2026-08-01', ndjson: '{"next":1}\n' };

it('S-BTN-244 appends private NDJSON batches and removes an interrupted tail', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'baton-event-archive-'));
  try {
    const path = join(dir, 'events.ndjson');
    const archive = fileEventArchive(path, null);
    await archive([part]);
    await appendFile(path, '{"next":' + ' '.repeat(5000));
    await archive([{ ...part, ndjson: '{"next":2}\n' }]);
    expect(await readFile(path, 'utf8')).toBe('{"next":1}\n{"next":2}\n');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(fileEventArchive(join(dir, 'missing', 'events.ndjson'), null)([part])).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('S-BTN-244 refuses SQLite aliases and non-private archive files without writing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'baton-event-archive-'));
  const path = join(dir, 'baton.db');
  const { db } = openStore(path);
  try {
    db.exec('CREATE TABLE test (id INTEGER)');
    for (const [index, sqlite] of [path, `${path}-wal`].entries()) {
      const before = await readFile(sqlite);
      const hard = join(dir, `hard-${index}`);
      const soft = join(dir, `soft-${index}`);
      await link(sqlite, hard);
      await symlink(sqlite, soft);
      await expect(fileEventArchive(hard, path)([part])).rejects.toThrow('separate from SQLite');
      await expect(fileEventArchive(soft, path)([part])).rejects.toMatchObject({ code: 'ELOOP' });
      expect(await readFile(sqlite)).toEqual(before);
    }
    const parentAlias = join(dir, 'alias');
    await symlink(dir, parentAlias);
    await expect(fileEventArchive(join(parentAlias, 'baton.db-journal'), path)([part])).rejects.toThrow('separate from SQLite');
    await expect(stat(`${path}-journal`)).rejects.toMatchObject({ code: 'ENOENT' });

    const publicFile = join(dir, 'public.ndjson');
    await writeFile(publicFile, part.ndjson);
    await chmod(publicFile, 0o644);
    await expect(fileEventArchive(publicFile, path)([part])).rejects.toThrow('private regular file');
    expect(await readFile(publicFile, 'utf8')).toBe(part.ndjson);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
