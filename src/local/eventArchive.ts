import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { EventArchive } from '../core/ports';

/** A private, single-writer archive. Its parent directory must already exist. */
export function fileEventArchive(path: string): EventArchive {
  const file = resolve(path);
  return async (parts) => {
    const handle = await open(file, 'a+', 0o600);
    try {
      const { size } = await handle.stat();
      const tail = Buffer.alloc(1);
      if (size > 0) await handle.read(tail, 0, 1, size - 1);
      // Separate a partial line after an interrupted append; the next batch retries its events.
      const prefix = size > 0 && tail[0] !== 10 ? '\n' : '';
      await handle.appendFile(prefix + parts.map((part) => part.ndjson).join(''));
      await handle.sync();
    } finally {
      await handle.close();
    }
    const parent = await open(dirname(file), 'r');
    try {
      await parent.sync(); // Make the directory entry durable on the first append, too.
    } finally {
      await parent.close();
    }
  };
}
