#!/usr/bin/env node
// spec-files.mjs — BATON_SPEC as one file per top-level section (B-179).
//
//   npm run spec:index    write spec/BATON_SPEC.md, the generated index of spec/BATON_SPEC/
//   node scripts/spec-files.mjs --prove <before> <after>
//                         the move's one-time proof: the parts at <after>, joined, are
//                         <before>:spec/BATON_SPEC.md byte for byte (B-179, recorded in its PR)
//
// The spec lives in `spec/BATON_SPEC/`, one file per `## ` heading of what was one file:
// `00-front.md` (the title, status, companions and contents), `01-…` to `16-…` (the numbered
// sections), and `90-…`, `91-…`, `92-…` (load-bearing assumptions, Decisions, Open questions).
// Joined in name order they are the spec: every tool that reads the spec reads the join
// (`specParts`, `joinParts` — check-spec and spec-tools both), so rule, scenario and gate ids,
// `§n.m` numbers and the checks are what they were. `locate` turns a line of the join back into
// `file:line`. `layoutProblems` is check:spec's check of the directory: every entry a part, the
// numbered parts in order under their own numbers, each part one heading and whole lines, and
// the index fresh.
//
// `spec/BATON_SPEC.md` is the index, every line of it generated (`indexText`): each section's
// file, its subsections and the rule ids each defines, then every rule, scenario and gate id with
// its title and file. It restates no rule (R-BTN-1, docs/context/spec-writing.mdx); `check:spec`
// fails when it is stale.
//
// `spec/` is a Grove bundle (B-180), so every part opens with frontmatter: `title` (the part's
// heading) and `description` (its first sentence), which `npm run spec:index` writes
// (`partFrontmatter`) beside any other keys a part keeps (the front's `status`, `updated`). A
// part's `text` is its body, the frontmatter stripped (scripts/lib/stripFrontmatter.mjs), so the
// join, the ids and the checks read only the spec's text; `offset` keeps `locate` on the file's
// own line numbers, and a part whose frontmatter is not the generated one is stale.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontmatterBlock } from './lib/stripFrontmatter.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The spec's directory and its index, relative to the repository. */
export const SPEC_DIR = 'spec/BATON_SPEC';
export const SPEC_INDEX = 'spec/BATON_SPEC.md';

/** A part file's name: two digits, a dash, a slug, `.md`. */
const PART = /^\d{2}-[a-z0-9-]+\.md$/;

/** The unnumbered parts after the sections, by prefix, and the heading each opens with. */
const APPENDICES = { 90: 'Load-bearing assumptions', 91: 'Decisions', 92: 'Open questions' };

/** The entries of `dir` (under `root`), sorted: the part files' names and every other name. */
function entries(root, dir) {
  const at = join(root, dir);
  if (!existsSync(at)) throw new Error(`${dir}: no such directory — the spec lives there, one file per section (B-179)`);
  const names = readdirSync(at).sort();
  return { at, parts: names.filter((n) => PART.test(n)), others: names.filter((n) => !PART.test(n)) };
}

/** A part read from its file's `raw` text: `text` is the body with the frontmatter stripped,
 *  `frontmatter` the block itself and `offset` its line count (B-180). */
export function part(name, path, raw) {
  const frontmatter = frontmatterBlock(raw);
  return { name, path, text: raw.slice(frontmatter.length), frontmatter, offset: frontmatter.split('\n').length - 1 };
}

/** The parts of the spec at `dir` (under `root`), in name order: [{name, path, text, frontmatter,
 *  offset}]. A name outside the grammar is no part; `layoutProblems` reports it rather than
 *  reading it. */
export function specParts(root = REPO, dir = SPEC_DIR) {
  const { at, parts } = entries(root, dir);
  return parts.map((name) => part(name, `${dir}/${name}`, readFileSync(join(at, name), 'utf8')));
}

/** The spec as one text: its parts joined in order. */
export const joinParts = (parts) => parts.map((p) => p.text).join('');

/** `file:line` for line `n` (1-based) of the join — the file's own line, past its frontmatter;
 *  past the end, `<dir>:n`. */
export function locate(parts, n, dir = SPEC_DIR) {
  let start = 1;
  for (const p of parts) {
    const lines = p.text.split('\n').length - (p.text.endsWith('\n') ? 1 : 0);
    if (n < start + lines) return `${p.path}:${n - start + 1 + (p.offset ?? 0)}`;
    start += lines;
  }
  return `${dir}:${n}`;
}

/** What is wrong with the parts' shape. Every part holds whole lines (it ends with a newline, so
 *  the join never runs one part's last line into the next's heading) with no carriage return.
 *  The first is the front, `00-…`. Every other opens with its one `## ` heading: `01-…` to `89-…`
 *  are the numbered sections, each headed with its own number (`02-…` opens `## 2. `), numbered
 *  1, 2, 3 … with none missing or repeated, so the name order is the spec's order; `90-…` on are
 *  the unnumbered appendices, each prefix with its own heading (`APPENDICES`). The front holds
 *  no numbered section. */
export function partProblems(parts) {
  const out = [];
  let next = 1;
  for (const [i, p] of parts.entries()) {
    if (!p.text.endsWith('\n')) out.push(`${p.path}: a part ends with a newline`);
    if (p.text.includes('\r')) out.push(`${p.path}: a part has \\n line ends, no \\r`);
    const headings = p.text.split('\n').filter((l) => /^## /.test(l));
    if (i === 0) {
      if (!p.name.startsWith('00-')) out.push(`${p.path}: the first part is the front, named 00-…`);
      if (p.text.split('\n').some((l) => /^## \d+\. /.test(l))) out.push(`${p.path}: the front holds no numbered section; each is its own part`);
      continue;
    }
    if (!p.text.startsWith('## ')) out.push(`${p.path}: a part opens with its \`## \` heading`);
    if (headings.length !== 1) out.push(`${p.path}: a part holds one \`## \` heading, not ${headings.length}`);
    const prefix = Number(p.name.slice(0, 2));
    const numbered = /^## (\d+)\. /.exec(p.text);
    if (prefix === 0) out.push(`${p.path}: only the front is named 00-…`);
    else if (prefix < 90) {
      if (prefix !== next) out.push(`${p.path}: the numbered parts run 01, 02, 03 … with none missing or repeated; this one should be ${String(next).padStart(2, '0')}-…`);
      if (!numbered || Number(numbered[1]) !== prefix) out.push(`${p.path}: a numbered part opens with its own number, \`## ${prefix}. \``);
      next = prefix + 1;
    } else if (numbered) out.push(`${p.path}: a part named 90-… or later is an appendix, with no section number`);
    else if (!(prefix in APPENDICES)) out.push(`${p.path}: no appendix is numbered ${prefix}; they are ${Object.entries(APPENDICES).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    else if (!p.text.startsWith(`## ${APPENDICES[prefix]}\n`)) out.push(`${p.path}: appendix ${prefix} opens with \`## ${APPENDICES[prefix]}\``);
  }
  return out;
}

/** Inline markdown as plain text: code spans, emphasis and links reduced to their words. */
const plain = (s) => s
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/`+([^`]*)`+/g, '$1')
  .replace(/\*\*|__|(?<![\w*])\*(?=\S)|(?<=\S)\*(?![\w*])/g, '')
  .replace(/\\([\\`*_{}[\]()#+.!<>-])/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

/** A part's title: its first heading (the front's `# `, a section's `## `), as plain text, with a
 *  section heading's status note (`*(proposal)*`) left to the body. */
export function partTitle(p) {
  const line = p.text.split('\n').find((l) => /^#{1,2} /.test(l)) ?? p.name;
  return plain(line.replace(/^#+ /, '').replace(/\s*\*\([^)]*\)\*\s*$/, ''));
}

/** A part's description: the first sentence of the first prose paragraph before its first `### `
 *  (not a heading, list, table, quote or bold label line), as plain text. The front's says what the
 *  front holds; a part with no such paragraph is described by its title. */
export function partDescription(p) {
  if (p.name.startsWith('00-')) return "BATON_SPEC's front: its title, status, companions and contents.";
  const blocks = p.text.split(/^### /m)[0].split(/\n\s*\n/);
  const prose = blocks.find((b) => !/^\s*(#|-|\*\s|\d+\.\s|\||>|```|<|\*\*[^*]+:\*\*)/.test(b) && b.trim());
  if (!prose) return `BATON_SPEC — ${partTitle(p)}.`;
  const text = plain(prose);
  return (/^(.+?[.!?])(?=\s+[A-Z(`"*§]|$)/.exec(text)?.[1] ?? text).trim();
}

/** A double-quoted YAML scalar (JSON's escapes are YAML's), as Grove's frontmatter reader decodes. */
const quoted = (s) => JSON.stringify(s);

/** The frontmatter `npm run spec:index` writes on a part: `title` and `description` generated
 *  (`partTitle`, `partDescription`), then every other key the part's block holds, in its order. */
export function partFrontmatter(p) {
  const kept = [];
  let skipping = false;
  for (const line of (p.frontmatter ?? '').split('\n').slice(1, -2)) {
    if (/^\S/.test(line)) skipping = /^(title|description)\s*:/.test(line);
    if (!skipping) kept.push(line);
  }
  return ['---', `title: ${quoted(partTitle(p))}`, `description: ${quoted(partDescription(p))}`, ...kept, '---', ''].join('\n');
}

/** check:spec's check of the spec's directory under `root`: every entry a part, the parts well
 *  formed (`partProblems`), each part's frontmatter the generated one (B-180), and the index the
 *  one `indexText` generates. */
export function layoutProblems(root = REPO, dir = SPEC_DIR, index = SPEC_INDEX) {
  const out = entries(root, dir).others.map((n) => `${dir}/${n}: not a part — a part is named NN-slug.md, and nothing else lives in ${dir}/ (B-179)`);
  const parts = specParts(root, dir);
  out.push(...partProblems(parts));
  for (const p of parts) {
    if (p.frontmatter !== partFrontmatter(p)) out.push(`${p.path}: its frontmatter is ${p.frontmatter ? 'stale' : 'missing'} — \`npm run spec:index\` writes its title and description (B-180)`);
  }
  const committed = existsSync(join(root, index)) ? readFileSync(join(root, index), 'utf8') : null;
  if (committed !== indexText(parts)) out.push(`${index} is ${committed == null ? 'missing' : 'stale'} — \`npm run spec:index\` writes it from ${dir}/ (B-179)`);
  return out;
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The move's proof: the parts' bodies, joined, against the body of the one file they were cut
 *  from — both with their frontmatter stripped (B-180: each part is a page with its own). */
export function moveProof(before, parts) {
  const joined = joinParts(parts);
  const body = before.slice(frontmatterBlock(before).length);
  return { ok: joined === body, before: sha256(body), after: sha256(joined), parts: parts.length };
}

const RULE = /^- \*\*(R-BTN-\d+(?: \/ R-BTN-\d+)*) \(([^)]*?)(?:\)|$)/;
// A scenario row names itself in its first cell (`| S-BTN-7 a scenario |`). A gate row has the id
// alone there and its statement in the second, which the index does not repeat: it restates no
// rule, so a gate is listed by id and file only.
const ROW = /^\| *([SG]-BTN-\d+)\b *([^|]*)\|/;

/** The index's text, generated from the parts. */
export function indexText(parts) {
  const out = [
    '---',
    'title: "BATON_SPEC — the index"',
    'description: "Each section\'s file, its subsections and the rules each defines, and every rule, scenario and gate id with its file. Generated by npm run spec:index."',
    'status: generated',
    '---',
    '',
    '# BATON_SPEC — the index',
    '',
    `Baton's specification lives in [\`${SPEC_DIR}/\`](BATON_SPEC/), one file per section. Open the`,
    'file that owns your topic; joined in order, the files are the whole spec. Rule, scenario and',
    'gate ids and `§n.m` numbers are stable, and a rule has one home: cite it by id',
    '([how to read and write the spec](../docs/context/spec-writing.mdx)). History, retired ids and',
    'the map from old section numbers: [`spec/BATON_SPEC_HISTORY.md`](BATON_SPEC_HISTORY.md).',
    '',
    `Generated by \`npm run spec:index\` from \`${SPEC_DIR}/\`; \`npm run check:spec\` fails when it`,
    'is stale. Never edit it by hand.',
    '',
    '## Sections and their topics',
    '',
    '| File | Section · subsection | Rules defined there |',
    '|---|---|---|',
  ];
  const ids = [];
  for (const p of parts) {
    let sub = null;
    const rows = [];
    const flush = () => {
      if (sub) rows.push(`| | ${sub.title} | ${sub.rules.join(', ') || '—'} |`);
    };
    let section = null;
    const sectionRules = [];
    for (const line of p.text.split('\n')) {
      const h2 = /^## (.+)$/.exec(line);
      if (h2) { section = h2[1].replace(/\s*\*\([^)]*\)\*\s*$/, ''); continue; }
      const h3 = /^### (.+)$/.exec(line);
      if (h3) { flush(); sub = { title: h3[1].replace(/\|/g, '\\|'), rules: [] }; continue; }
      const r = RULE.exec(line);
      if (r) {
        for (const id of r[1].split(' / ')) {
          (sub ? sub.rules : sectionRules).push(id);
          ids.push({ id, title: r[2].trim().replace(/\|/g, '\\|'), path: p.path });
        }
        continue;
      }
      const row = ROW.exec(line);
      if (row) ids.push({ id: row[1], title: row[2].trim().replace(/\*\*/g, ''), path: p.path });
    }
    flush();
    const name = p.name.startsWith('00-') ? 'Front matter: status, companions, contents' : section ?? p.name;
    out.push(`| [\`${p.name}\`](BATON_SPEC/${p.name}) | **${name.replace(/\|/g, '\\|')}** | ${sectionRules.join(', ') || '—'} |`);
    out.push(...rows);
  }
  const n = (id) => Number(/(\d+)$/.exec(id)[1]);
  const kind = (id) => id.split('-')[0];
  const seen = new Set();
  const uniq = ids.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  for (const [k, heading] of [['R', 'Rules'], ['S', 'Scenarios'], ['G', 'Gates']]) {
    const titled = k !== 'G';
    out.push('', `## ${heading}`, '', titled ? '| Id | Title | File |' : '| Id | File |', titled ? '|---|---|---|' : '|---|---|');
    for (const x of uniq.filter((u) => kind(u.id) === k).sort((a, b) => n(a.id) - n(b.id))) {
      const file = `[\`${x.path.split('/').pop()}\`](BATON_SPEC/${x.path.split('/').pop()})`;
      out.push(titled ? `| ${x.id} | ${x.title || '—'} | ${file} |` : `| ${x.id} | ${file} |`);
    }
  }
  out.push('');
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--prove') {
  const [before, after] = process.argv.slice(3);
  if (!before || !after) {
    console.error('usage: spec-files.mjs --prove <commit before the move> <commit of the move>');
    process.exit(2);
  }
  const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  const names = git('ls-tree', '--name-only', `${after}:${SPEC_DIR}`).split('\n').filter((n) => PART.test(n)).sort();
  const parts = names.map((name) => part(name, `${SPEC_DIR}/${name}`, git('show', `${after}:${SPEC_DIR}/${name}`)));
  const proof = moveProof(git('show', `${before}:${SPEC_INDEX}`), parts);
  console.log(`${before}:${SPEC_INDEX}  sha-256 ${proof.before}`);
  console.log(`${after}:${SPEC_DIR}/ (${proof.parts} parts, joined)  sha-256 ${proof.after}`);
  console.log(proof.ok ? 'spec-files --prove: identical, byte for byte' : 'spec-files --prove: DIFFERENT');
  process.exit(proof.ok ? 0 : 1);
} else if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.length > 2) {
  console.error('usage: spec-files.mjs                 write the index\n       spec-files.mjs --prove <before> <after>');
  process.exit(2);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parts = specParts();
  let written = 0;
  for (const p of parts) {
    const fm = partFrontmatter(p);
    if (fm !== p.frontmatter) { writeFileSync(join(REPO, p.path), fm + p.text); written++; }
  }
  writeFileSync(join(REPO, SPEC_INDEX), indexText(parts));
  console.log(`spec:index — wrote ${SPEC_INDEX} from ${parts.length} part(s) of ${SPEC_DIR}/, and the frontmatter of ${written} part(s)`);
}
