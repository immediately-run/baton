#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Check live instructions and implementation. Historical records, captured data, tests,
// append-only migrations and site registration are not instructions to access a checkout.
const live = (file) => /^(?:README\.md|AGENTS\.md|CLAUDE\.md|\.baton\/courses\/|cli\/|scripts\/|src\/|docs\/(?:[^/]+\.mdx?$|context\/)|spec\/BATON_SPEC\/)/.test(file)
  && !/^(?:src\/migrations\/|docs\/(?:lessons|interventions)\.mdx$|scripts\/check-standalone(?:\.self-test)?\.mjs$)/.test(file);

export function checkReferences(root, file, text) {
  const issues = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    // Only single-line notes are exempt; they cannot accidentally hide the next paragraph.
    if (/^\s*<!-- dependency-history: .* -->\s*$/.test(line)
      || (file === 'src/core/board.ts' && line.trim() === 'const path = `content/roadmap/${it.id}.mdx`; // dependency-history: legacy ticket URL, not an input')) continue;
    if (/immediately-run\/docs\b|(?:^|[^\w-])content\//.test(line)) issues.push(index + 1);
    else for (const [link] of line.matchAll(/(?:\.\.\/)+docs(?:\/[^\s`'"<>)]*)?(?=$|[\s`'"<>),.;])/g)) {
      const target = resolve(root, dirname(file), link.split('#')[0]);
      // Relative links into this checkout's docs directory are not a sibling dependency.
      const fromDocs = relative(resolve(root, 'docs'), target);
      if (fromDocs === '..' || fromDocs.startsWith('../') || !existsSync(target)) {
        issues.push(index + 1);
        break;
      }
    }
  }
  return issues;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  for (const file of files.filter(live)) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    for (const line of checkReferences(root, file, readFileSync(path, 'utf8'))) {
      console.error(`${file}:${line}: reference to the consumer repository`);
      process.exitCode = 1;
    }
  }
}
