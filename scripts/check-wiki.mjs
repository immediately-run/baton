#!/usr/bin/env node
// check-wiki.mjs — check the repository's Grove wikis: each folder `package.json`'s
// "immediately.run".content lists (`tickets/`, the tickets; `docs/`, the documentation), each
// opened on immediately.run through its own immediately.run.json.
//
//   npm run check:wiki                 check every bundle; exit 1 on any error
//   node scripts/check-wiki.mjs DIR…   check these bundle folders instead (the self-test uses this)
//
// Every page:
//   - has YAML frontmatter with `title` and `description` (a `_layout.mdx` needs only the latter);
//   - compiles as MDX — a bare `<word>` or `{word}` in prose fails here, as it would in Grove;
//   - uses only Grove's built-in components and the ones its bundle's immediately.run.json registers;
//   - has no `import`/`export` and no `{expression}` other than a `{/* comment */}`;
//   - links ([text](path), [[path]] and [[label|path]]) only to files that exist, relative to the page.
// In a bundle with an item.schema.json (tickets/), every ticket — a file named like an id, in
// the bundle's root or its archive/:
//   - matches item.schema.json: its required keys, no other keys, the id pattern and the
//     status enum;
//   - is named after its id; is `done` in archive/ and never `done` outside it;
//   - depends only on tickets that exist, live or archived.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { compile, createProcessor } from '@mdx-js/mdx';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Grove's built-in components (grove's viewer.manifest.json), always in scope in an entry. */
const GROVE = ['Backlinks', 'Callout', 'ChildPages', 'Directory', 'DirectoryList', 'DocList', 'DocsByTag',
  'FamilyTree', 'GroveFooter', 'GroveNav', 'GroveSidebar', 'Infobox', 'Kbd', 'KeyValue', 'LayoutGallery',
  'Lede', 'More', 'Outlet', 'PageMeta', 'Quote', 'RecentlyUpdated', 'TableOfContents', 'TagCloud', 'TagList',
  'ThemeGallery', 'Timeline', 'Toc'];

const errors = [];
const fail = (file, msg) => errors.push(`${relative(REPO, file) || file}: ${msg}`);
const processor = createProcessor();

/** Every .mdx under a bundle, except its components folder and `_`-prefixed folders. */
function pages(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'components' || name.startsWith('_') ? [] : pages(path);
    return name.endsWith('.mdx') ? [path] : [];
  });
}

/** Frontmatter and body; the frontmatter's lines are blanked in the body so positions hold. */
function split(file, text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) { fail(file, 'no YAML frontmatter'); return { meta: {}, body: text }; }
  let meta = {};
  try { meta = parseYaml(m[1]) ?? {}; } catch (e) { fail(file, `frontmatter is not YAML: ${e.message.split('\n')[0]}`); }
  return { meta, body: '\n'.repeat(m[0].split('\n').length - 1) + text.slice(m[0].length) };
}

/** A relative link target, resolved against the page; null for external links and anchors. */
function target(file, url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/')) return null;
  const path = decodeURIComponent(url.split('#')[0]);
  return path ? resolve(dirname(file), path) : null;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/** Check one bundle; answers how many pages and tickets it holds. */
async function checkBundle(root) {
  const markerPath = join(root, 'immediately.run.json');
  if (!existsSync(markerPath)) { fail(root, 'no immediately.run.json'); return { pages: 0, tickets: 0 }; }
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  const components = new Set([...GROVE, ...Object.keys(marker.components ?? {})]);
  const schemaPath = join(root, 'item.schema.json');
  const schema = existsSync(schemaPath) ? JSON.parse(readFileSync(schemaPath, 'utf8')) : null;
  const idPattern = schema && new RegExp(schema.definitions.itemId.pattern);
  const tickets = new Map(); // id → { file, meta }
  const files = pages(root);

  for (const file of files) {
    const { meta, body } = split(file, readFileSync(file, 'utf8'));
    const name = file.split(sep).pop();
    if (name !== '_layout.mdx' && typeof meta.title !== 'string') fail(file, 'frontmatter has no title');
    if (typeof meta.description !== 'string') fail(file, 'frontmatter has no description');

    const rel = relative(root, file).split(sep);
    const live = rel.length === 1;
    const archived = rel.length === 2 && rel[0] === 'archive';
    const stem = name.replace(/\.mdx$/, '');
    if (schema && (live || archived) && idPattern.test(stem)) {
      for (const key of schema.required) if (!(key in meta)) fail(file, `ticket has no ${key}`);
      for (const key of Object.keys(meta)) if (!schema.propertyNames.enum.includes(key)) fail(file, `ticket has an unknown key ${key}`);
      if (meta.id !== stem) fail(file, `id ${meta.id} does not match the file name`);
      if (!schema.properties.status.enum.includes(meta.status)) fail(file, `status ${meta.status} is not one of ${schema.properties.status.enum.join(', ')}`);
      if (archived && meta.status !== 'done') fail(file, `an archived ticket is done, not ${meta.status}`);
      if (live && meta.status === 'done') fail(file, 'a done ticket belongs in archive/');
      if (tickets.has(stem)) fail(file, `${stem} is also ${relative(REPO, tickets.get(stem).file)}`);
      tickets.set(stem, { file, meta });
    }

    try {
      await compile(body);
    } catch (e) {
      fail(file, `does not compile as MDX: ${e.reason ?? e.message} (line ${e.line ?? e.place?.line ?? '?'}) — put code-like text in backticks, or escape < and { as \\< and \\{`);
      continue;
    }

    walk(processor.parse(body), (node) => {
      const line = node.position?.start.line;
      if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name && /^[A-Z]/.test(node.name) && !components.has(node.name)) {
        fail(file, `line ${line}: <${node.name}> is neither a Grove component nor registered in immediately.run.json`);
      }
      if (node.type === 'mdxjsEsm') fail(file, `line ${line}: import/export is not allowed in a page`);
      if ((node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') && node.data?.estree?.body.length) {
        fail(file, `line ${line}: {${node.value.trim().slice(0, 30)}} is an expression; only {/* comments */} are allowed`);
      }
      if (node.type === 'link' || node.type === 'definition') {
        const path = target(file, node.url);
        if (path && !existsSync(path)) fail(file, `line ${line}: link to ${node.url}, which does not exist`);
      }
      if (node.type === 'text') {
        // Grove's wiki-link syntax is [[target]] or [[label|target]] (label first).
        for (const [, inner] of node.value.matchAll(/\[\[([^[\]]+)\]\]/g)) {
          const link = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1) : inner;
          const path = target(file, link.trim());
          if (path && !existsSync(path)) fail(file, `line ${line}: [[${link}]] does not exist`);
        }
      }
    });
  }

  for (const [id, { file, meta }] of tickets) {
    const deps = meta.depends_on ?? [];
    if (!Array.isArray(deps)) { fail(file, 'depends_on is not a list'); continue; }
    for (const dep of deps) {
      if (!idPattern.test(String(dep))) fail(file, `depends_on ${dep} is not a ticket id`);
      else if (!tickets.has(dep)) fail(file, `depends_on ${dep}, which is not a ticket here`);
      else if (dep === id) fail(file, 'depends on itself');
    }
  }
  return { pages: files.length, tickets: tickets.size };
}

const declared = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))['immediately.run']?.content;
const roots = process.argv.length > 2 ? process.argv.slice(2) : [declared ?? []].flat().map((d) => join(REPO, d));
if (!roots.length) { console.error('check-wiki: package.json declares no "immediately.run".content bundles'); process.exit(1); }

const summary = [];
for (const root of roots) {
  const { pages: n, tickets: t } = await checkBundle(resolve(root));
  summary.push(`${relative(REPO, resolve(root)) || root}: ${n} page(s)${t ? `, ${t} ticket(s)` : ''}`);
}
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`check-wiki: ${errors.length} error(s)`);
  process.exit(1);
}
console.log(`check-wiki OK — ${summary.join('; ')}`);
