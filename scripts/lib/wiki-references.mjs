import { existsSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { createProcessor } from '@mdx-js/mdx';

const processor = createProcessor({ format: 'md' });
const SCRIPT = /\bnpm\s+run\s+([\w:.-]+)/g;
const EXTENSIONLESS = /^(?:LICEN[CS]E|COPYING|NOTICE|README|CHANGELOG|AUTHORS|CONTRIBUTORS|Makefile|Dockerfile)(?:[-.][\w.-]+)?$/;

/** Literal relative paths, not HTTP paths, globs, placeholders or package names. */
function pathOf(span) {
  const value = span.trim();
  if (!/^(?:\.\.?\/)*(?:[\w.-]+\/)*[\w.-]+\/?$/.test(value) || value === '.' || value === '..') return null;
  return value.includes('/') || EXTENSIONLESS.test(value) || /\.(?:[cm]?[jt]sx?|mdx?|ya?ml|json|toml|qnt|sql|sh|html|css|lock)$/.test(value) ? value : null;
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
  function checkScripts(parts) {
    const text = parts.map(({ value }) => value).join('');
    for (const match of text.matchAll(SCRIPT)) {
      const name = match[1].replace(/\.+$/, '');
      if (Object.hasOwn(scripts, name)) continue;
      let offset = match.index;
      const part = parts.find(({ value }) => {
        if (offset < value.length) return true;
        offset -= value.length;
        return false;
      });
      const line = part.line + part.value.slice(0, offset).split('\n').length - 1;
      problems.push({ line, message: `npm script ${name} does not exist` });
    }
  }
  function visit(node, parts, link) {
    if (node.type === 'link') link = node.url.split(/[?#]/, 1)[0];
    if (node.type === 'inlineCode') {
      const command = /^(?:node|bash|sh)\s+(\S+)/.exec(node.value);
      const path = pathOf(command ? command[1] : node.value);
      const candidates = path && (/^\.\.?\//.test(path) ? [dirname(filename)] : bases);
      const localLabel = path && link && pathOf(link) && !path.includes('/') && basename(link) === path;
      const linkedFile = localLabel && resolve(dirname(filename), link);
      if (candidates && !(linkedFile && inRepo(linkedFile) && existsSync(linkedFile)) && !candidates.some((base) => {
        const target = resolve(base, path);
        return inRepo(target) && existsSync(target);
      })) problems.push({ line: node.position.start.line, path, message: `repository path ${path} does not exist` });
    }
    if (node.type === 'code') {
      checkScripts([{ value: node.value, line: node.position.start.line + 1 }]);
      return;
    }
    if (['paragraph', 'heading', 'tableCell'].includes(node.type)) {
      const inline = [];
      for (const child of node.children ?? []) visit(child, inline);
      checkScripts(inline);
      return;
    }
    if (parts && ['inlineCode', 'text', 'break'].includes(node.type)) {
      parts.push({ value: node.value ?? '\n', line: node.position.start.line });
    }
    for (const child of node.children ?? []) visit(child, parts, link);
  }
  visit(processor.parse(body));
  return problems;
}
