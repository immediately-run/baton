#!/usr/bin/env node
// spec-tools.mjs — two checks that keep a spec amendment from stopping half-way.
//
//   npm run spec:impact -- R-BTN-39 [R-BTN-35 …] [--term "course history" …]
//       every rule, scenario, gate and decision of the spec, and every live ticket and context
//       page, that cites one of the ids or uses one of the terms: the places an amendment to those
//       rules must reach, or be shown not to need to. Printed as a checklist for the PR body.
//
//   patchNotes(spec, prefix) — the rules whose heading is followed by an italic sentence
//       (`- **R-BTN-35 (…).** *Except …*`): an exception stated on top of a rule whose body still
//       says the opposite. check-spec fails on any not in its shrinking allowlist.
//
// The same file lives in immediately-run/baton and immediately-run/fieldhouse (one copy each,
// since neither imports the other's scripts); CONFIG below is the only difference.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const CONFIG = {
  prefix: 'R-BTN',
  spec: 'spec/BATON_SPEC.md',
  /** Live tickets (the archive is history) and the context corpus, which restate rules. */
  dirs: ['tickets', 'docs/context'],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ids a rule heading line defines: `- **R-X-1 (…)**` or `- **R-X-1 / R-X-2 (…)**`. */
function headingIds(line, prefix) {
  const m = new RegExp(`^- \\*\\*(${esc(prefix)}-\\d+(?: \\/ ${esc(prefix)}-\\d+)*)`).exec(line);
  return m ? m[1].split(' / ') : null;
}

/** The rule ids whose heading is followed by an italic sentence. */
export function patchNotes(spec, prefix = CONFIG.prefix) {
  const re = new RegExp(`^- \\*\\*(${esc(prefix)}-\\d+)\\b[^\\n]*?\\*\\*\\.? \\*(?!\\*)`, 'gm');
  return [...spec.matchAll(re)].map((m) => m[1]);
}

/** The spec cut into units: rules (a heading to the next heading or section), scenario and gate
 *  rows, and Decisions bullets. Each unit: {kind, label, line, text}. */
export function units(spec, prefix = CONFIG.prefix) {
  const lines = spec.split('\n');
  const out = [];
  let rule = null;
  let section = '';
  const close = () => { if (rule) { out.push(rule); rule = null; } };
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^#{1,4} /.test(line)) { close(); section = line.replace(/^#+ /, ''); return; }
    const ids = headingIds(line, prefix);
    if (ids) {
      close();
      const title = /\(([^)]*)\)/.exec(line)?.[1] ?? '';
      rule = { kind: 'rule', label: `${ids.join(' / ')} (${title})`, ids, line: n, text: line };
      return;
    }
    const row = /^\| *([SG]-[A-Z]+-\d+)\b/.exec(line);
    if (row) {
      close();
      out.push({ kind: row[1].startsWith('S') ? 'scenario' : 'gate', label: row[1], line: n, text: line });
      return;
    }
    if (section.startsWith('Decisions') && line.startsWith('- ')) {
      close();
      rule = { kind: 'decision', label: line.slice(2, 80) + (line.length > 80 ? '…' : ''), line: n, text: line };
      return;
    }
    if (rule) rule.text += `\n${line}`;
  });
  close();
  return out;
}

/** Why a text matches: the ids it cites and the terms it uses. */
function reasons(text, ids, terms) {
  const r = [];
  for (const id of ids) if (new RegExp(`\\b${esc(id)}\\b`).test(text)) r.push(`cites ${id}`);
  for (const t of terms) if (text.toLowerCase().includes(t.toLowerCase())) r.push(`uses "${t}"`);
  return r;
}

/** The impact of amending `ids` (and anything using `terms`): the units and files to check. */
export function impact(spec, ids, terms = [], files = [], prefix = CONFIG.prefix) {
  const changed = [];
  const spec_hits = [];
  for (const u of units(spec, prefix)) {
    if (u.ids && u.ids.some((id) => ids.includes(id))) { changed.push(u); continue; }
    const why = reasons(u.text, ids, terms);
    if (why.length) spec_hits.push({ ...u, why });
  }
  const file_hits = [];
  for (const [path, text] of files) {
    const why = reasons(text, ids, terms);
    if (why.length) file_hits.push({ path, why });
  }
  return { changed, spec: spec_hits, files: file_hits };
}

/** The checklist an amendment's PR body carries. */
export function render(result, specPath = CONFIG.spec) {
  const out = ['### Impact', ''];
  out.push(`Changed: ${result.changed.map((u) => `${u.label} (l. ${u.line})`).join('; ') || 'none of the ids is a rule heading'}`, '');
  out.push(`In \`${specPath}\` — mark each **changed** or **still true**:`, '');
  for (const u of result.spec) out.push(`- [ ] ${u.kind} ${u.label} — l. ${u.line} — ${u.why.join(', ')}`);
  if (!result.spec.length) out.push('- (nothing else cites them)');
  out.push('', 'Outside the spec (live tickets, context pages):', '');
  for (const f of result.files) out.push(`- [ ] \`${f.path}\` — ${f.why.join(', ')}`);
  if (!result.files.length) out.push('- (nothing)');
  return out.join('\n');
}

function mdx(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.mdx?$/.test(e.name))
    .map((e) => join(dir, e.name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] !== 'impact' || args.length < 2) {
    console.error('usage: spec-tools.mjs impact <rule id>… [--term "<words>"]…');
    process.exit(2);
  }
  const ids = [];
  const terms = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--term') terms.push(args[++i]);
    else ids.push(args[i]);
  }
  const spec = readFileSync(join(REPO, CONFIG.spec), 'utf8');
  const files = CONFIG.dirs.flatMap((d) => mdx(join(REPO, d)))
    .map((p) => [p.slice(REPO.length + 1), readFileSync(p, 'utf8')]);
  console.log(render(impact(spec, ids, terms, files)));
}
