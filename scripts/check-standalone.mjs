#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProcessor } from '@mdx-js/mdx';

// Scan tracked text by default. These are ledgers, captured artifacts or immutable SQL,
// not setup or agent instructions. Ticket bodies describe work across repositories.
const records = /^(?:tickets\/|(?:docs|spec)\/review\/|src\/migrations\/|docs\/(?:lessons\.mdx|interventions\.mdx|design\/baton-dashboard-v2\.html)$|spec\/BATON_SPEC_HISTORY\.md$)/;
// Pin individual legacy fixture lines, not entire test files. New or changed code is scanned.
const fixtureLines = JSON.parse(readFileSync(new URL('./standalone-fixture-lines.json', import.meta.url), 'utf8'));

const processors = { md: createProcessor({ format: 'md' }), mdx: createProcessor() };
const siblingDocs = /(?:\.\.\/)+docs(?:\/[^\s`'"<>()[\]#?,;]*)?(?![\w-])/g;
const consumer = /immediately-run\/docs(?![\w-])|(?:^|[^\w-])content\//;
const historyNote = /^\s*<!-- dependency-history: (?:(?!-->|<!--).)*-->\s*$/;

function markdownExemptions(root, file, text) {
  const destinations = new Map();
  const notes = new Set();
  const processor = processors[file.match(/\.(mdx?)$/)?.[1]];
  if (!processor || (!text.includes('../docs') && !text.includes('dependency-history:'))) return { destinations, notes };
  let tree;
  try {
    tree = processor.parse(text);
  } catch {
    // A parse failure must not turn an unverified destination into an exemption.
    return { destinations, notes };
  }
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (node.children) pending.push(...node.children);
    if (node.type === 'html' && historyNote.test(node.value)) {
      notes.add(node.position.start.line);
    }
    if (node.type !== 'link' || !/^(?:\.\.\/)+docs(?:\/|[?#]|$)/.test(node.url)) continue;
    // Use the parsed label's end to locate the raw destination, not any matching
    // text in the label or the optional title. Unrecognized spellings stay checked.
    const labelEnd = node.children.at(-1)?.position.end.offset ?? node.position.start.offset + 1;
    const tail = text.slice(labelEnd, node.position.end.offset);
    const opening = /^\]\(\s*(<?)/.exec(tail);
    if (!opening || !tail.startsWith(node.url, opening[0].length)) continue;
    const afterUrl = tail.slice(opening[0].length + node.url.length);
    if (opening[1] ? !afterUrl.startsWith('>') : !/^[\s)]/.test(afterUrl)) continue;
    const path = node.url.split(/[?#]/, 1)[0];
    const target = resolve(root, dirname(file), path);
    if (!existsSync(target)) continue;
    const fromDocs = relative(resolve(root, 'docs'), realpathSync(target));
    if (!isAbsolute(fromDocs) && fromDocs !== '..' && !fromDocs.startsWith(`..${sep}`)) {
      destinations.set(labelEnd + opening[0].length, path);
    }
  }
  return { destinations, notes };
}

function withoutHistoricalReferences(file, line) {
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
  const { destinations, notes } = markdownExemptions(root, file, text);
  let offset = 0;
  for (const [index, rawLine] of text.split('\n').entries()) {
    const line = rawLine.replace(/\r$/, '');
    const history = notes.has(index + 1) && historyNote.test(line);
    const active = history ? '' : withoutHistoricalReferences(file, line);
    if (consumer.test(active) || Array.from(active.matchAll(siblingDocs))
      .some(({ 0: path, index: start }) => active !== line || destinations.get(offset + start) !== path)) {
      issues.push(index + 1);
    }
    offset += rawLine.length + 1;
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
