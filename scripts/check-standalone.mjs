#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Scan tracked text by default. These are ledgers, captured artifacts or immutable SQL,
// not setup or agent instructions. Ticket bodies describe work across repositories.
const records = /^(?:tickets\/|(?:docs|spec)\/review\/|src\/migrations\/|docs\/(?:lessons\.mdx|interventions\.mdx|design\/baton-dashboard-v2\.html)$|spec\/BATON_SPEC_HISTORY\.md$)/;

function withoutHistoricalReferences(file, line) {
  const prose = /\.mdx?$/.test(file);
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
  // Signed sync and migration tests use demo repo IDs and legacy paths as data. Sibling
  // paths (even if they contain one of these strings) are always checked in the original line.
  if (file.startsWith('test/')) return line.replace(/immediately-run\/docs\b|\bcontent\/(?:roadmap|chore)\b/g, '');
  return line;
}

export function checkReferences(root, file, text) {
  const issues = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const active = withoutHistoricalReferences(file, line);
    if (!active) continue;
    if (/immediately-run\/docs(?![\w-])|(?:^|[^\w-])content\//.test(active)) issues.push(index + 1);
    else for (const [link] of line.matchAll(/(?:\.\.\/)+docs(?:\/[^\s`'"<>()[\]#?,;]*)?(?![\w-])/g)) {
      const target = resolve(root, dirname(file), link);
      // Relative links into this checkout's docs directory are not a sibling dependency.
      const fromDocs = existsSync(target) ? relative(resolve(root, 'docs'), realpathSync(target)) : '..';
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
