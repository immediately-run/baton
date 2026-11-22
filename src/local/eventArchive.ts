import { constants } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { EventArchive } from '../core/ports';

/** Discard only bytes after the last completed NDJSON record. */
async function repairTail(handle: FileHandle, size: number) {
  const chunk = Buffer.alloc(Math.min(size, 4096));
  for (let end = size; end > 0;) {
    const start = Math.max(0, end - chunk.length);
    const length = end - start;
    const { bytesRead } = await handle.read(chunk, 0, length, start);
    if (bytesRead !== length) throw new Error('short read of event archive tail');
    const newline = chunk.subarray(0, length).lastIndexOf(10);
    if (newline !== -1) {
      if (start + newline + 1 < size) await handle.truncate(start + newline + 1);
      return;
    }
    end = start;
  }
  if (size > 0) await handle.truncate(0);
}

/** A private, single-writer archive. Its parent directory must already exist. */
export function fileEventArchive(path: string, database: string | null): EventArchive {
  const file = resolve(path);
  return async (parts) => {
    const parentPath = await realpath(dirname(file));
    const target = join(parentPath, basename(file));
    const db = database === null ? null : await realpath(database);
    const protectedPaths = db === null ? [] : [db, `${db}-wal`, `${db}-shm`, `${db}-journal`];
    if (protectedPaths.includes(target)) throw new Error('event archive must be separate from SQLite files');

    const { O_RDWR, O_APPEND, O_CREAT, O_NOFOLLOW, O_NONBLOCK } = constants;
    const handle = await open(target, O_RDWR | O_APPEND | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0o600);
    try {
      const opened = await handle.stat({ bigint: true });
      for (const path of protectedPaths) {
        const sqlite = await stat(path, { bigint: true }).catch((e) => {
          if (path !== db && e.code === 'ENOENT') return null; // SQLite may not use all sidecars.
          throw e;
        });
        if (sqlite?.dev === opened.dev && sqlite.ino === opened.ino) {
          throw new Error('event archive must be separate from SQLite files');
        }
      }
      if (!opened.isFile() || opened.nlink !== 1n || (opened.mode & 0o077n) !== 0n) {
        throw new Error('event archive must be a private regular file with one link');
      }
      await repairTail(handle, Number(opened.size));
      await handle.appendFile(parts.map((part) => part.ndjson).join(''));
      await handle.sync();
    } finally {
      await handle.close();
    }
    const parent = await open(parentPath, 'r');
    try {
      await parent.sync(); // Make the directory entry durable on the first append, too.
    } finally {
      await parent.close();
    }
  };
}
