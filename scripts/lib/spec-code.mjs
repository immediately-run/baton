import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function files(root, dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = `${dir}/${entry.name}`;
    if (path === 'src/dashboard/dist') return [];
    return entry.isDirectory() ? files(root, path) : /\.(?:[cm]?[jt]sx?|qnt|sql|mdx?)$/.test(entry.name) ? [path] : [];
  });
}

export function readSpecCode(root) {
  return ['src', 'test', 'model', 'cli', 'scripts'].flatMap((dir) => files(root, dir))
    .map((path) => [path, readFileSync(join(root, path), 'utf8')]);
}
