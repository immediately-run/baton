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
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The spec's directory and its index, relative to the repository. */
export const SPEC_DIR = 'spec/BATON_SPEC';
export const SPEC_INDEX = 'spec/BATON_SPEC.md';

/** A part file's name: two digits, a dash, a slug, `.md`. */
const PART = /^\d{2}-[a-z0-9-]+\.md$/;

/** The entries of `dir` (under `root`), sorted: the part files' names and every other name. */
function entries(root, dir) {
  const at = join(root, dir);
  if (!existsSync(at)) throw new Error(`${dir}: no such directory — the spec lives there, one file per section (B-179)`);
  const names = readdirSync(at).sort();
  return { at, parts: names.filter((n) => PART.test(n)), others: names.filter((n) => !PART.test(n)) };
}

/** The parts of the spec at `dir` (under `root`), in name order: [{name, path, text}]. A name
 *  outside the grammar is no part; `layoutProblems` reports it rather than reading it. */
export function specParts(root = REPO, dir = SPEC_DIR) {
  const { at, parts } = entries(root, dir);
  return parts.map((name) => ({ name, path: `${dir}/${name}`, text: readFileSync(join(at, name), 'utf8') }));
}

/** The spec as one text: its parts joined in order. */
export const joinParts = (parts) => parts.map((p) => p.text).join('');

/** `file:line` for line `n` (1-based) of the join; past the end, `<dir>:n`. */
export function locate(parts, n, dir = SPEC_DIR) {
  let start = 1;
  for (const p of parts) {
    const lines = p.text.split('\n').length - (p.text.endsWith('\n') ? 1 : 0);
    if (n < start + lines) return `${p.path}:${n - start + 1}`;
    start += lines;
  }
  return `${dir}:${n}`;
}

/** What is wrong with the parts' shape. Every part holds whole lines (it ends with a newline, so
 *  the join never runs one part's last line into the next's heading) with no carriage return.
 *  The first is the front, `00-…`. Every other opens with its one `## ` heading: `01-…` to `89-…`
 *  are the numbered sections, each headed with its own number (`02-…` opens `## 2. `), numbered
 *  1, 2, 3 … with none missing or repeated, so the name order is the spec's order; `90-…` on are
 *  the unnumbered appendices. */
export function partProblems(parts) {
  const out = [];
  let next = 1;
  for (const [i, p] of parts.entries()) {
    if (!p.text.endsWith('\n')) out.push(`${p.path}: a part ends with a newline`);
    if (p.text.includes('\r')) out.push(`${p.path}: a part has \\n line ends, no \\r`);
    const headings = p.text.split('\n').filter((l) => /^## /.test(l));
    if (i === 0) {
      if (!p.name.startsWith('00-')) out.push(`${p.path}: the first part is the front, named 00-…`);
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
  }
  return out;
}

/** check:spec's check of the spec's directory under `root`: every entry a part, the parts well
 *  formed (`partProblems`), and the index the one `indexText` generates. */
export function layoutProblems(root = REPO, dir = SPEC_DIR, index = SPEC_INDEX) {
  const out = entries(root, dir).others.map((n) => `${dir}/${n}: not a part — a part is named NN-slug.md, and nothing else lives in ${dir}/ (B-179)`);
  const parts = specParts(root, dir);
  out.push(...partProblems(parts));
  const committed = existsSync(join(root, index)) ? readFileSync(join(root, index), 'utf8') : null;
  if (committed !== indexText(parts)) out.push(`${index} is ${committed == null ? 'missing' : 'stale'} — \`npm run spec:index\` writes it from ${dir}/ (B-179)`);
  return out;
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The move's proof: the parts, joined, against the one file they were cut from. */
export function moveProof(before, parts) {
  const joined = joinParts(parts);
  return { ok: joined === before, before: sha256(before), after: sha256(joined), parts: parts.length };
}

const RULE = /^- \*\*(R-BTN-\d+(?: \/ R-BTN-\d+)*) \(([^)]*?)(?:\)|$)/;
// A scenario row names itself in its first cell (`| S-BTN-7 a scenario |`); a gate row has the id
// alone there and its title in the second (`| G-BTN-9 | a gate |`).
const ROW = /^\| *([SG]-BTN-\d+)\b *([^|]*)\|([^|]*)\|/;

/** The index's text, generated from the parts. */
export function indexText(parts) {
  const out = [
    '---',
    'title: "BATON_SPEC — the index"',
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
      if (row) ids.push({ id: row[1], title: (row[2].trim() || row[3].trim()).replace(/\*\*/g, '') || '—', path: p.path });
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
    out.push('', `## ${heading}`, '', '| Id | Title | File |', '|---|---|---|');
    for (const x of uniq.filter((u) => kind(u.id) === k).sort((a, b) => n(a.id) - n(b.id))) {
      out.push(`| ${x.id} | ${x.title} | [\`${x.path.split('/').pop()}\`](BATON_SPEC/${x.path.split('/').pop()}) |`);
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
  const parts = names.map((name) => ({ name, path: `${SPEC_DIR}/${name}`, text: git('show', `${after}:${SPEC_DIR}/${name}`) }));
  const proof = moveProof(git('show', `${before}:${SPEC_INDEX}`), parts);
  console.log(`${before}:${SPEC_INDEX}  sha-256 ${proof.before}`);
  console.log(`${after}:${SPEC_DIR}/ (${proof.parts} parts, joined)  sha-256 ${proof.after}`);
  console.log(proof.ok ? 'spec-files --prove: identical, byte for byte' : 'spec-files --prove: DIFFERENT');
  process.exit(proof.ok ? 0 : 1);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parts = specParts();
  writeFileSync(join(REPO, SPEC_INDEX), indexText(parts));
  console.log(`spec:index — wrote ${SPEC_INDEX} from ${parts.length} part(s) of ${SPEC_DIR}/`);
}
