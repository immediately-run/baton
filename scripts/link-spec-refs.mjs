#!/usr/bin/env node
// link-spec-refs.mjs — a ticket's or a page's BATON_SPEC section citations as links (B-180).
//
//   node scripts/link-spec-refs.mjs            rewrite live tickets and docs/ pages in place
//   node scripts/link-spec-refs.mjs --check    write nothing; exit 1 when a rewrite is due
//   node scripts/link-spec-refs.mjs FILE…      only these files
//
// `spec/` is a Grove bundle (B-180), so a citation of a spec section can be a plain relative link
// that GitHub follows and Grove opens in the spec bundle. This turns `` `spec/BATON_SPEC.md` §6.1 ``
// and the bare `BATON_SPEC §6.1` into `[BATON_SPEC §6.1](../spec/BATON_SPEC/06-….md#sec-6-1)`,
// and each further `§n[.m]` of the same paragraph that follows such a citation into
// `[§n.m](…)` — up to another spec's name (`BATON_MCP_OAUTH_SPEC`, `BATON_SPEC_HISTORY.md`, a
// code span naming another file), which ends the run. A `§` before any BATON_SPEC citation is
// left alone: it may be another spec's.
//
// The file and the heading come from the generated index (spec/BATON_SPEC.md: each section's file
// and its subsections); the anchor is `headingId` of that heading as read from the section's
// file — the function Grove's heading anchors use (@immediately-run/mdx-plugins). A `§` the index
// does not list (an old number like `§2f`, or a third level) is reported and left as it is,
// never guessed. Text in code, in a link, in an expression or in the frontmatter is not touched.
// A second run changes nothing. Archived tickets (`tickets/archive/`) and the dated reviews
// (`docs/review/`) are history, cited in the numbering of their day, and are not rewritten.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProcessor } from '@mdx-js/mdx';
import { headingId } from '@immediately-run/mdx-plugins';
import { frontmatterBlock } from './lib/stripFrontmatter.mjs';
import { SPEC_INDEX } from './spec-files.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const processor = createProcessor();

/** A heading's text as Grove flattens it: text and code contribute their value; emphasis,
 *  strong and links their children; JSX and expressions nothing. */
function headingText(node) {
  let out = '';
  const visit = (n) => {
    if (n.type === 'text' || n.type === 'inlineCode') { out += n.value ?? ''; return; }
    if (n.type === 'mdxJsxTextElement' || n.type === 'mdxTextExpression') return;
    for (const c of n.children ?? []) visit(c);
  };
  for (const c of node.children ?? []) visit(c);
  return out;
}

/** The sections the index lists: `§n` and `§n.m` → { file (repository-relative), id, heading }.
 *  The index names each section's file and its subsections; the heading and its anchor are read
 *  from that file. */
export function specTargets(root = REPO, index = SPEC_INDEX) {
  const text = readFileSync(join(root, index), 'utf8');
  const wanted = new Map(); // number → file
  let file = null;
  for (const line of text.split('\n')) {
    const row = /^\| \[`[^`]+`\]\(([^)]+)\) \| \*\*(\d+)\. /.exec(line);
    if (row) { file = join(dirname(index), row[1]).split(sep).join('/'); wanted.set(row[2], file); continue; }
    if (/^\| \[`/.test(line)) { file = null; continue; }
    const sub = /^\| \| (\d+\.\d+) /.exec(line);
    if (sub && file) wanted.set(sub[1], file);
  }
  const headings = new Map(); // file → [{number, text}]
  const out = new Map();
  for (const [number, path] of wanted) {
    if (!headings.has(path)) {
      const raw = readFileSync(join(root, path), 'utf8');
      const tree = processor.parse(raw.slice(frontmatterBlock(raw).length));
      const list = [];
      for (const node of tree.children) {
        if (node.type !== 'heading' || node.depth > 3) continue;
        const t = headingText(node).trim();
        const n = /^(\d+(?:\.\d+)?)\.?(?:\s|$)/.exec(t);
        if (n) list.push({ number: n[1], text: t });
      }
      headings.set(path, list);
    }
    const h = headings.get(path).find((x) => x.number === number);
    if (h) out.set(number, { file: path, id: headingId(h.text), heading: h.text });
  }
  return out;
}

const ANCHOR_CODE = new Set(['spec/BATON_SPEC.md', 'spec/BATON_SPEC/', 'BATON_SPEC']);
/** A code span that names another file or another spec ends a run of BATON_SPEC citations. */
const OTHER_CODE = /[A-Z0-9]_SPEC|\.mdx?\b|\//;
// In text: the bare spec name, another spec's name, a `§` number, or a table cell's edge.
const TOKEN = /(?<![\w/.-])BATON_SPEC(?![\w/.-])|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_SPEC(?:_[A-Z0-9]+)*\b|§(\d+[a-z]?(?:\.\d+[a-z]?)*)(?![\w])|\|/g;

/** Rewrite one page's text. `page` is its repository-relative path, for the links' relative
 *  paths. Answers the new text, the citations linked and the ones that could not be mapped. */
export function rewrite(text, page, targets) {
  const fm = frontmatterBlock(text);
  const body = text.slice(fm.length);
  let tree;
  try { tree = processor.parse(body); } catch (e) {
    return { text, linked: [], unmapped: [], error: `${page}: does not parse as MDX (${e.reason ?? e.message})` };
  }
  const edits = []; // { start, end, replacement } in body offsets
  const linked = [];
  const unmapped = [];
  const lineOf = (offset) => fm.split('\n').length - 1 + body.slice(0, offset).split('\n').length;
  const url = (t) => `${relative(dirname(page), t.file).split(sep).join('/')}#${t.id}`;

  /** The leaves of an inline run, in order: text slices, code spans and links. */
  function leaves(nodes, out = []) {
    for (const n of nodes) {
      if (n.type === 'text') out.push({ kind: 'text', start: n.position.start.offset, end: n.position.end.offset });
      else if (n.type === 'inlineCode') out.push({ kind: 'code', value: n.value, start: n.position.start.offset, end: n.position.end.offset });
      else if (n.type === 'link' || n.type === 'linkReference') out.push({ kind: 'link', url: n.url ?? '' });
      else if (['strong', 'emphasis', 'delete'].includes(n.type)) leaves(n.children ?? [], out);
      else out.push({ kind: 'other' });
    }
    return out;
  }

  function run(nodes) {
    let active = false;
    let skipTo = -1; // a code span's citation consumed the start of the next text
    const items = leaves(nodes);
    items.forEach((leaf, i) => {
      if (leaf.kind === 'link') { if (leaf.url.includes('spec/BATON_SPEC/')) active = true; return; }
      if (leaf.kind === 'code') {
        if (ANCHOR_CODE.has(leaf.value.trim())) {
          active = true;
          const next = items[i + 1];
          if (next?.kind === 'text' && next.start === leaf.end) {
            const m = /^[ \t]*\n?[ \t]*§(\d+(?:\.\d+)?)(?!\w|\.\d)/.exec(body.slice(next.start, next.end));
            const t = m && targets.get(m[1]);
            if (t) {
              edits.push({ start: leaf.start, end: next.start + m[0].length, replacement: `[BATON_SPEC §${m[1]}](${url(t)})` });
              linked.push({ line: lineOf(leaf.start), ref: `§${m[1]}` });
              skipTo = next.start + m[0].length;
            }
          }
        } else if (OTHER_CODE.test(leaf.value)) active = false;
        return;
      }
      if (leaf.kind !== 'text') return;
      const from = Math.max(leaf.start, skipTo);
      const slice = body.slice(from, leaf.end);
      for (const m of slice.matchAll(TOKEN)) {
        const at = from + m.index;
        if (m[0] === '|') { active = false; continue; }
        if (m[0] === 'BATON_SPEC') {
          active = true;
          const after = /^[ \t]*§(\d+(?:\.\d+)?)(?!\w|\.\d)/.exec(body.slice(at + m[0].length, leaf.end));
          const t = after && targets.get(after[1]);
          if (t) {
            const end = at + m[0].length + after[0].length;
            edits.push({ start: at, end, replacement: `[BATON_SPEC §${after[1]}](${url(t)})` });
            linked.push({ line: lineOf(at), ref: `§${after[1]}` });
            skipTo = end;
          }
          continue;
        }
        if (!m[0].startsWith('§')) { active = false; continue; }
        if (at < skipTo || !active) continue;
        const t = targets.get(m[1]);
        if (!t) { unmapped.push({ line: lineOf(at), ref: m[0] }); continue; }
        edits.push({ start: at, end: at + m[0].length, replacement: `[${m[0]}](${url(t)})` });
        linked.push({ line: lineOf(at), ref: m[0] });
      }
    });
  }

  const BLOCKS = new Set(['paragraph', 'heading', 'tableCell']);
  const SKIP = new Set(['code', 'html', 'mdxjsEsm', 'mdxFlowExpression', 'yaml', 'toml']);
  (function walk(node) {
    if (SKIP.has(node.type)) return;
    if (BLOCKS.has(node.type)) { run(node.children ?? []); return; }
    for (const c of node.children ?? []) walk(c);
  })(tree);

  let out = body;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return { text: fm + out, linked, unmapped };
}

/** The pages the rewrite covers: live tickets and docs/ pages, without the archive and the dated
 *  reviews. */
export function defaultPages(root = REPO) {
  const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) return rel === 'docs/review' ? [] : walk(rel);
    return /\.mdx?$/.test(name) ? [rel] : [];
  });
  const tickets = readdirSync(join(root, 'tickets')).filter((n) => /\.mdx$/.test(n) && !n.startsWith('_')).map((n) => `tickets/${n}`);
  return [...tickets, ...walk('docs')].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const files = args.filter((a) => a !== '--check').map((f) => relative(REPO, resolve(f)).split(sep).join('/'));
  const pages = files.length ? files : defaultPages();
  const targets = specTargets();
  let due = 0;
  let links = 0;
  const unmapped = [];
  const errors = [];
  for (const page of pages) {
    if (!existsSync(join(REPO, page))) { errors.push(`${page}: no such file`); continue; }
    const before = readFileSync(join(REPO, page), 'utf8');
    const r = rewrite(before, page, targets);
    if (r.error) errors.push(r.error);
    for (const u of r.unmapped) unmapped.push(`${page}:${u.line}: ${u.ref} — not a section the index lists; left as it is`);
    if (r.text === before) continue;
    due++;
    links += r.linked.length;
    if (check) console.log(`${page}: ${r.linked.length} citation(s) to link`);
    else writeFileSync(join(REPO, page), r.text);
  }
  for (const u of unmapped) console.log(`? ${u}`);
  for (const e of errors) console.error(`✗ ${e}`);
  if (check) {
    console.log(due ? `link-spec-refs: ${due} page(s) have citations to link — run node scripts/link-spec-refs.mjs` : `link-spec-refs OK — ${pages.length} page(s), nothing to link; ${unmapped.length} citation(s) not mapped`);
    process.exit(due || errors.length ? 1 : 0);
  }
  console.log(`link-spec-refs — linked ${links} citation(s) in ${due} page(s); ${unmapped.length} citation(s) not mapped`);
  process.exit(errors.length ? 1 : 0);
}
