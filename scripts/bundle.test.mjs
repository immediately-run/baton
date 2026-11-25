import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { bundleLocal } from './bundle.mjs';

it('S-BTN-28: rebuilding the course kit does not truncate the bundle a reader has opened', async () => {
  const out = resolve(import.meta.dirname, '../.local');
  await mkdir(out, { recursive: true });
  const dir = await mkdtemp(join(out, 'bundle-test-'));
  const name = basename(dir);
  const destination = join(dir, 'kit.mjs');
  const prior = 'export const version = "prior";\n';
  try {
    await writeFile(destination, prior);
    await writeFile(join(dir, 'entry.mjs'), 'export const version = "new";\n');
    const reader = await open(destination, 'r');
    try {
      const kit = await bundleLocal(`.local/${name}/entry.mjs`, `${name}/kit.mjs`);
      expect(kit.version).toBe('new');
      expect(await readFile(destination, 'utf8')).toContain('"new"');
      expect(await reader.readFile('utf8')).toBe(prior);
    } finally {
      await reader.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
