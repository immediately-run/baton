// read-items.ts — the markdown ticket source's file walk (BATON_SPEC §2f R-BTN-74): every file
// under `items`, at any depth (an `archive/` of done tickets included). One module, imported by
// the sync and bundled into an ejected `.baton/tickets.mjs`, so the two never drift.
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { MarkdownFile } from './tickets-markdown';

/** Every file under `<root>/<items>`, each path relative to `items` with `/` separators, in
 * path order. A missing `items` is no tickets; any other read error fails the sync. */
export function readItems(root: string, items = 'tickets'): MarkdownFile[] {
  const dir = join(root, items);
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort()
    .map((path) => ({ path, text: readFileSync(join(dir, path), 'utf8') }));
}
