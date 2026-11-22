import { createHash } from 'node:crypto';
import { chmod, lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { PreparationError } from './preparation';

export function within(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

export const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/** Walk without following links. The cache seal includes names, kinds, modes and file bytes. */
export async function treeFiles(root: string, mode: 'verify' | 'seal' | 'unseal' | 'inspect', signal?: AbortSignal,
  links: ReadonlyMap<string, string> = new Map()): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (path: string) => {
    signal?.throwIfAborted();
    const st = await lstat(path);
    const name = relative(root, path);
    const readonly = st.mode & 0o7555;
    if (st.isSymbolicLink()) {
      if (mode === 'unseal') return;
      const link = await readlink(path);
      const target = await realpath(path).catch(() => null);
      // The caller has checked that this exact absolute link names a digest entry.
      // A missing entry can be restored from the lockfile, but a redirected entry cannot.
      const missingDigest = mode === 'verify' && target === null && links.get(path) === link
        && await lstat(link).then(() => false, (e) => e.code === 'ENOENT');
      if (!missingDigest && (!target || (!within(root, target) && links.get(path) !== target))) {
        throw new PreparationError('spec', `symlink ${name} resolves outside the leg tree or digest (R-BTN-133)`);
      }
      hash.update(JSON.stringify([name, 'link', link]));
      return;
    }
    if (!st.isDirectory() && !st.isFile()) throw new PreparationError('spec', `${name} is not a regular file or directory (R-BTN-133)`);
    if (mode === 'verify' && (st.mode & 0o222)) throw new Error(`${name || root} is writable`);
    if (mode === 'unseal' && st.isDirectory()) await chmod(path, (st.mode & 0o777) | 0o700);
    if (st.isDirectory()) {
      hash.update(JSON.stringify([name, 'dir', readonly]));
      for (const child of (await readdir(path)).sort()) await walk(join(path, child));
    } else if (mode !== 'unseal') {
      hash.update(JSON.stringify([name, 'file', readonly, digest(await readFile(path))]));
    }
    if (mode === 'seal') await chmod(path, readonly);
  };
  await walk(root);
  return hash.digest('hex');
}
