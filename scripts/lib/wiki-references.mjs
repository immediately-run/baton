import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { createProcessor } from '@mdx-js/mdx';

const processor = createProcessor({ format: 'md' });
const SCRIPT = /\bnpm[ \t]+run[ \t]+([\w:-]+)/g;

/** Literal relative paths, not HTTP paths, globs, placeholders or package names. */
function pathOf(span) {
  const value = span.trim();
  if (!/^(?:\.\.?\/)*(?:[\w.-]+\/)*[\w.-]+\/?$/.test(value) || value === '.' || value === '..') return null;
  return value.includes('/') || /\.(?:[cm]?[jt]sx?|mdx?|ya?ml|json|toml|qnt|sql|sh|html|css|lock)$/.test(value) ? value : null;
}

/** Check paths relative to the page or the repository, never outside the checkout. */
export function referenceProblems(root, file, body, scripts) {
  const problems = [];
  const filename = resolve(root, file);
  const inRepo = (path) => !relative(root, path).split(sep).includes('..');
  const bases = [];
  for (let dir = dirname(filename); inRepo(dir); dir = dirname(dir)) {
    bases.push(dir);
    if (dir === root) break;
  }
  function visit(node, link) {
    if (node.type === 'link') link = node.url;
    if (node.type === 'inlineCode') {
      const command = /^(?:node|bash|sh)\s+(\S+)/.exec(node.value);
      const path = !link && pathOf(command ? command[1] : node.value);
      const candidates = path && (/^\.\.?\//.test(path) ? [dirname(filename)] : bases);
      if (candidates && !candidates.some((base) => {
        const target = resolve(base, path);
        return inRepo(target) && existsSync(target);
      })) problems.push({ line: node.position.start.line, path, message: `repository path ${path} does not exist` });
    }
    if (['inlineCode', 'text', 'code'].includes(node.type)) {
      for (const match of node.value.matchAll(SCRIPT)) {
        const line = node.position.start.line + (node.type === 'code' ? 1 : 0) + node.value.slice(0, match.index).split('\n').length - 1;
        if (!Object.hasOwn(scripts, match[1])) problems.push({ line, message: `npm script ${match[1]} does not exist` });
      }
    }
    for (const child of node.children ?? []) visit(child, link);
  }
  visit(processor.parse(body));
  return problems;
}
