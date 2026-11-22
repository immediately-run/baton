import { appendFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { fileEventArchive } from '../../src/local/eventArchive';

it('S-BTN-244 appends private NDJSON batches and separates an interrupted line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'baton-event-archive-'));
  try {
    const path = join(dir, 'events.ndjson');
    const archive = fileEventArchive(path);
    const part = { repository: 'baton', day: '2026-08-01', ndjson: '{"next":1}\n' };
    await archive([part]);
    await appendFile(path, '{"next":');
    await archive([{ ...part, ndjson: '{"next":2}\n' }]);
    expect(await readFile(path, 'utf8')).toBe('{"next":1}\n{"next":\n{"next":2}\n');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(fileEventArchive(join(dir, 'missing', 'events.ndjson'))([part])).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
