// B-282: each TypeScript source belongs to one project's root set. An import can still bring
// it into another project's program, e.g. the local host checking portable core on Node.
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');

function coverageProblems(sources, projects) {
  const owners = new Map(sources.map((path) => [path, []]));
  for (const [project, files] of projects) {
    for (const file of files) owners.get(file)?.push(project);
  }
  return [...owners].flatMap(([path, names]) => names.length === 1 ? [] : [
    `${path}: ${names.length ? `included by ${names.join(', ')}` : 'not included by any tsconfig'}`,
  ]);
}

function projectFiles(path) {
  const file = resolve(root, path);
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  const parsed = !error && ts.parseJsonConfigFileContent(config, ts.sys, dirname(file), undefined, file);
  const errors = error ? [error] : parsed.errors;
  if (errors.length) {
    throw new Error(`${path}: ${errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`);
  }
  return parsed.fileNames.map((name) => relative(root, name));
}

describe('TypeScript project coverage (B-282)', () => {
  it('includes every checked-in or new TypeScript file in exactly one project', () => {
    const paths = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root, encoding: 'utf8',
    }).split('\0').filter(Boolean))];
    const sources = paths.filter((path) => /\.(?:[cm]?ts|tsx)$/.test(path) && ts.sys.fileExists(resolve(root, path)));
    const projects = paths.filter((path) => /^tsconfig(?:\.[\w-]+)?\.json$/.test(path));
    expect(sources.length).toBeGreaterThan(0);
    expect(coverageProblems(sources, projects.map((path) => [path, projectFiles(path)]))).toEqual([]);
  });

  it('reports both missing files and duplicate owners', () => {
    expect(coverageProblems(['one.ts', 'missing.ts', 'duplicate.ts'], [
      ['tsconfig.json', ['one.ts', 'duplicate.ts']],
      ['tsconfig.local.json', ['duplicate.ts']],
    ])).toEqual([
      'missing.ts: not included by any tsconfig',
      'duplicate.ts: included by tsconfig.json, tsconfig.local.json',
    ]);
  });
});
