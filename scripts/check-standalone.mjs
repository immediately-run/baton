#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Scan tracked text by default. These are ledgers, captured artifacts or immutable SQL,
// not setup or agent instructions. Ticket bodies describe work across repositories.
const records = /^(?:tickets\/|(?:docs|spec)\/review\/|src\/migrations\/|docs\/(?:lessons\.mdx|interventions\.mdx|design\/baton-dashboard-v2\.html)$|spec\/BATON_SPEC_HISTORY\.md$)/;
// Pin individual legacy fixture lines, not entire test files. New or changed code is scanned.
const fixtureLines = JSON.parse(readFileSync(new URL('./standalone-fixture-lines.json', import.meta.url), 'utf8'));

function withoutHistoricalReferences(file, line, prose) {
  // Only a standalone comment is a note; the first closing delimiter ends the note.
  if (prose && /^\s*<!-- dependency-history: (?:(?!-->|<!--).)*-->\s*$/.test(line)) return '';
  if (file === 'src/core/board.ts' && line.trim() === 'const path = `content/roadmap/${it.id}.mdx`; // dependency-history: legacy ticket URL, not an input') return '';
  // Site configuration names a supported code repo and an existing seed, not a build input.
  if (file === '.baton/baton.json' && line.trim() === '"docs": "immediately-run/docs",') return '';
  if (file === 'wrangler.toml' && line.startsWith("BATON_REPOSITORIES = '[")) {
    return line.replaceAll(/"(?:github|remote)":"(?:https:\/\/github\.com\/)?immediately-run\/docs(?:\.git)?"/g, '');
  }
  // The existing CI annotation is historical; its workflow is operator-owned.
  if (file === '.github/workflows/ci.yml' && line.trim() === '- run: npm run check:wiki   # content/, the tickets\' wiki') return '';
  // The spec index generator emits this Markdown link relative to spec/, not scripts/.
  if (file === 'scripts/spec-files.mjs' && line.trim() === "'([how to read and write the spec](../docs/context/spec-writing.mdx)). History, retired ids and',") {
    return line.replace('../docs/context/spec-writing.mdx', '');
  }
  // These captured JSON documents contain IDs and URLs from the old producer.
  if (file === 'test/fixtures/boards.json' || file === 'test/fixtures/courses/roadmap-pr/course.json') {
    return line.replace(/immediately-run\/docs\b|\bcontent\/(?:roadmap|chore)\b/g, '');
  }
  if (Object.hasOwn(fixtureLines, file) && /immediately-run\/docs|content\//.test(line)
    && fixtureLines[file].includes(createHash('sha256').update(line.trim()).digest('hex'))) return '';
  return line;
}

export function checkReferences(root, file, text) {
  const issues = [];
  const markdown = /\.mdx?$/.test(file);
  let fence;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const delimiter = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (markdown && delimiter) {
      const [, token, rest] = delimiter;
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length && !rest.trim()) fence = undefined;
    }
    const active = withoutHistoricalReferences(file, line, markdown && !fence);
    if (!active) continue;
    if (/immediately-run\/docs(?![\w-])|(?:^|[^\w-])content\//.test(active)) issues.push(index + 1);
    else for (const { 0: link, index: start } of active.matchAll(/(?:\.\.\/)+docs(?:\/[^\s`'"<>()[\]#?,;]*)?(?![\w-])/g)) {
      const target = resolve(root, dirname(file), link);
      // Only a Markdown destination is relative to the document. A code string may be
      // relative to the process's working directory instead.
      const prefix = active.slice(0, start).replace(/(`+)(?:(?!\1).)*\1/g, 'label');
      const suffix = active.slice(start + link.length);
      const destination = markdown && !fence && !prefix.includes('`') && /\[[^\]\n]+\]\($/.test(prefix)
        && /^(?:[?#][^\s)`]*)?\)/.test(suffix);
      const fromDocs = destination && existsSync(target) ? relative(resolve(root, 'docs'), realpathSync(target)) : '..';
      if (fromDocs === '..' || fromDocs.startsWith('../')) {
        issues.push(index + 1);
        break;
      }
    }
  }
  return issues;
}

export function checkTrackedReferences(root) {
  const findings = [];
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  for (const file of files.filter((file) => file && !records.test(file)
    && !/^scripts\/check-standalone(?:\.self-test)?\.mjs$/.test(file))) {
    const path = resolve(root, file);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) continue;
    const data = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
    if (data.includes(0)) continue;
    for (const line of checkReferences(root, file, data.toString('utf8'))) {
      findings.push(`${file}:${line}: reference to the consumer repository`);
    }
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = checkTrackedReferences(resolve(import.meta.dirname, '..'));
  for (const finding of findings) console.error(finding);
  if (findings.length) process.exitCode = 1;
}
