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
// `[§n.m](…)`, and each rule, scenario or gate id (`R-BTN-n`, `S-BTN-n`, `G-BTN-n`) into
// `[R-BTN-n](…)`, a link to the section the index puts it in — up to another spec's name
// (`BATON_MCP_OAUTH_SPEC`, `BATON_SPEC_HISTORY.md`, a code span naming one), which ends the run;
// any other code span (`` `schemas/<name>.json` ``) leaves it going. A `§` or an id before any
// BATON_SPEC citation is left alone: it may be another spec's. A `` `spec/BATON_SPEC.md` `` code
// span that opens a run becomes the plain name `BATON_SPEC` when citations after it in the
// paragraph are now links; on a `**Spec:**` line that cites nothing linkable after it (`the whole
// spec`) it becomes a link to the index (`[BATON_SPEC](…/spec/BATON_SPEC.md)`, no anchor);
// anywhere else it stays, since it may name the file itself.
//
// The file and the heading come from the generated index (spec/BATON_SPEC.md: each section's file,
// its subsections and the rules each defines, and the file of every scenario and gate); the anchor
// is `headingId` of that heading as read from the section's file — the function Grove's heading
// anchors use (@immediately-run/mdx-plugins). A scenario or gate links to its file's `Scenarios` or
// `Gates` heading. A `§` or an id the index does not list (an old number like `§2f`, a third level,
// a retired rule) is reported and left as it is, never guessed. Text in code, in a link, in an expression or in the frontmatter is not touched.
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

const ID = /[RSG]-BTN-\d+/g;

/** What the index lists, each with where it links: `§n` and `§n.m` (keyed `6` and `6.1`) and
 *  every rule, scenario and gate id (keyed `R-BTN-120`) → { file (repository-relative), id,
 *  heading }. The index names each section's file, its subsections and the rules defined in each,
 *  and each scenario's and gate's file; the heading and its anchor are read from that file. */
export function specTargets(root = REPO, index = SPEC_INDEX) {
  const text = readFileSync(join(root, index), 'utf8');
  const wanted = new Map(); // number → file
  const ruleAt = new Map(); // rule id → number
  const rowAt = new Map(); // scenario or gate id → file
  const at = (link) => join(dirname(index), link).split(sep).join('/');
  let file = null;
  let number = null;
  for (const line of text.split('\n')) {
    const row = /^\| \[`[^`]+`\]\(([^)]+)\) \| \*\*(\d+)\. [^|]*\| ([^|]*)\|/.exec(line);
    if (row) {
      file = at(row[1]); number = row[2]; wanted.set(number, file);
      for (const id of row[3].match(ID) ?? []) ruleAt.set(id, number);
      continue;
    }
    if (/^\| \[`/.test(line)) { file = null; continue; }
    const sub = /^\| \| (\d+\.\d+) [^|]*\| ([^|]*)\|/.exec(line);
    if (sub && file) {
      wanted.set(sub[1], file);
      for (const id of sub[2].match(ID) ?? []) ruleAt.set(id, sub[1]);
      continue;
    }
    const sg = /^\| ([SG]-BTN-\d+) \|.*\[`[^`]+`\]\(([^)]+)\) \|$/.exec(line);
    if (sg) rowAt.set(sg[1], at(sg[2]));
  }
  const headings = new Map(); // file → [{number, text}]
  const headingsOf = (path) => {
    if (!headings.has(path)) {
      const raw = readFileSync(join(root, path), 'utf8');
      const tree = processor.parse(raw.slice(frontmatterBlock(raw).length));
      const list = [];
      for (const node of tree.children) {
        if (node.type !== 'heading' || node.depth > 3) continue;
        const t = headingText(node).trim();
        list.push({ number: /^(\d+(?:\.\d+)?)\.?(?:\s|$)/.exec(t)?.[1] ?? null, text: t });
      }
      headings.set(path, list);
    }
    return headings.get(path);
  };
  const out = new Map();
  for (const [n, path] of wanted) {
    const h = headingsOf(path).find((x) => x.number === n);
    if (h) out.set(n, { file: path, id: headingId(h.text), heading: h.text });
  }
  for (const [id, n] of ruleAt) if (out.has(n)) out.set(id, out.get(n));
  for (const [id, path] of rowAt) {
    const name = id.startsWith('S') ? 'Scenarios' : 'Gates';
    const h = headingsOf(path).find((x) => x.text === name) ?? headingsOf(path).find((x) => x.number);
    if (h) out.set(id, { file: path, id: headingId(h.text), heading: h.text });
  }
  return out;
}

const ANCHOR_CODE = new Set(['spec/BATON_SPEC.md', 'spec/BATON_SPEC/', 'BATON_SPEC']);
/** A code span that names another spec ends a run of BATON_SPEC citations; any other leaves it. */
const OTHER_CODE = /[A-Z0-9]_SPEC/;
/** A link into the spec (a section's file, or the index) is a BATON_SPEC citation itself. */
const SPEC_LINK = /(?:^|\/)spec\/BATON_SPEC(?:\/|\.md(?:$|#))/;
// In text: the bare spec name, another spec's name, a `§` number, a rule, scenario or gate id, or
// a table cell's edge.
const TOKEN = /(?<![\w/.-])BATON_SPEC(?![\w/.-])|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_SPEC(?:_[A-Z0-9]+)*\b|§(\d+[a-z]?(?:\.\d+[a-z]?)*)(?![\w])|(?<![\w/.-])([RSG]-BTN-\d+)(?![\w-]|\.\w)|\|/g;

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
  const rel = (file) => relative(dirname(page), file).split(sep).join('/');
  const url = (t) => `${rel(t.file)}#${t.id}`;

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

  function run(nodes, specLine) {
    let active = false;
    let skipTo = -1; // a code span's citation consumed the start of the next text
    const opened = []; // `spec/BATON_SPEC.md` spans that open a run: { start, end, edits }
    const items = leaves(nodes);
    items.forEach((leaf, i) => {
      if (leaf.kind === 'link') { if (SPEC_LINK.test(leaf.url)) active = true; return; }
      if (leaf.kind === 'code') {
        if (ANCHOR_CODE.has(leaf.value.trim())) {
          active = true;
          let consumed = false;
          const next = items[i + 1];
          if (next?.kind === 'text' && next.start === leaf.end) {
            const m = /^[ \t]*\n?[ \t]*§(\d+(?:\.\d+)?)(?!\w|\.\d)/.exec(body.slice(next.start, next.end));
            const t = m && targets.get(m[1]);
            if (t) {
              edits.push({ start: leaf.start, end: next.start + m[0].length, replacement: `[BATON_SPEC §${m[1]}](${url(t)})` });
              linked.push({ line: lineOf(leaf.start), ref: `§${m[1]}` });
              skipTo = next.start + m[0].length;
              consumed = true;
            }
          }
          if (!consumed && leaf.value.trim() === 'spec/BATON_SPEC.md') opened.push({ start: leaf.start, end: leaf.end, edits: edits.length });
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
        if (m[2]) {
          if (at < skipTo || !active) continue;
          const t = targets.get(m[2]);
          if (!t) { unmapped.push({ line: lineOf(at), ref: m[2] }); continue; }
          edits.push({ start: at, end: at + m[2].length, replacement: `[${m[2]}](${url(t)})` });
          linked.push({ line: lineOf(at), ref: m[2] });
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
    // A `spec/BATON_SPEC.md` span that opened a run: the plain name when what follows it in the
    // paragraph is now linked, else a link to the whole spec, its index.
    for (const o of opened) {
      if (edits.length > o.edits) edits.push({ start: o.start, end: o.end, replacement: 'BATON_SPEC' });
      else if (specLine) edits.push({ start: o.start, end: o.end, replacement: `[BATON_SPEC](${rel(SPEC_INDEX)})` });
    }
  }

  const BLOCKS = new Set(['paragraph', 'heading', 'tableCell']);
  const SKIP = new Set(['code', 'html', 'mdxjsEsm', 'mdxFlowExpression', 'yaml', 'toml']);
  (function walk(node) {
    if (SKIP.has(node.type)) return;
    if (BLOCKS.has(node.type)) {
      const first = node.children?.[0];
      const specLine = first?.type === 'strong' && /^Spec:?$/.test(first.children?.[0]?.value ?? '');
      run(node.children ?? [], specLine);
      return;
    }
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
