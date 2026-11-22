// B-139 / R-BTN-134: read Git objects, never a cached working tree or filters.
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { COURSE_ID } from '../core/course';
import { GIT_NONINTERACTIVE_ENV } from './ticket-state';
import type { CourseSource } from './course-source';

const gitEnv = () => ({ ...process.env, ...GIT_NONINTERACTIVE_ENV, GIT_NO_REPLACE_OBJECTS: '1' });
const options = () => ({ env: gitEnv(), maxBuffer: 16 << 20, killSignal: 'SIGKILL' as const });

function git(cwd: string | undefined, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { ...options(), cwd, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]}: ${stderr.trim() || err.message}`));
      else resolve(stdout);
    });
  });
}

export function coursePath(id: string): string {
  if (!COURSE_ID.test(id)) throw new Error(`invalid course id ${JSON.stringify(id)}`);
  return `.baton/courses/${id}`;
}

export interface CourseFile {
  path: string;
  regular: boolean;
  read(): Buffer;
}

export function courseFiles(root: string, sha: string, id: string): CourseFile[] {
  const base = coursePath(id);
  const prefix = `${base}/`;
  const call = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { ...options(), timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  return call('ls-tree', '-rz', sha, '--', base).toString('utf8').split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, , object] = line.slice(0, tab).split(' ');
    const path = line.slice(tab + 1);
    return { path: path === base ? '.' : path.slice(prefix.length), regular: path !== base && (mode === '100644' || mode === '100755'), read: () => call('cat-file', 'blob', object) };
  });
}

/** Only regular, top-level leg overrides belong in a sourced home. */
export const isOverride = (path: string): boolean => /^legs\/[a-z][a-z0-9-]*(?:\.md|\.run\.[a-z0-9]+)$/.test(path);

/** One bare object cache per upstream. Resolve HEAD afresh, fetch by branch (never by id),
 * and prove the pin against the head returned by that very fetch. No tree is reused. */
export async function fetchCourse(src: CourseSource, cache: string): Promise<CourseFile[]> {
  const slug = `${src.namespace}/${src.repository}`.toLowerCase();
  const url = `https://github.com/${slug}.git`;
  const repo = join(cache, ...slug.split('/'));
  if (!existsSync(repo)) {
    mkdirSync(dirname(repo), { recursive: true, mode: 0o700 });
    const tmp = mkdtempSync(join(dirname(repo), '.init-'));
    try {
      await git(tmp, 'init', '--bare', '-q');
      try { renameSync(tmp, repo); } catch (e) { if (!existsSync(repo)) throw e; }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  const remoteHead = await git(repo, 'ls-remote', '--symref', url, 'HEAD');
  const branch = /^ref: (refs\/heads\/[^\t\n]+)\tHEAD$/m.exec(remoteHead)?.[1];
  if (!branch) throw new Error(`${slug}: the remote did not name a default branch`);
  // An isolated ref allows concurrent claims to validate against their own fetch.
  const ref = `refs/baton/fetch/${randomBytes(12).toString('hex')}`;
  try {
    await git(repo, 'fetch', '-q', '--no-tags', '--no-write-fetch-head', url, `+${branch}:${ref}`);
    if ((await git(repo, 'cat-file', '-t', src.ref)).trim() !== 'commit') throw new Error(`${src.ref} is not a commit`);
    await git(repo, 'merge-base', '--is-ancestor', src.ref, ref).catch(() => {
      throw new Error(`${src.ref} is not an ancestor of ${slug}'s ${branch}`);
    });
    return courseFiles(repo, src.ref, src.course);
  } finally {
    await git(repo, 'update-ref', '-d', ref);
  }
}

export function writeCourseTree(dir: string, files: CourseFile[], seal = true): Record<string, string> {
  const dirs = new Set([dir]);
  const blobs: Record<string, string> = Object.create(null);
  for (const file of files) {
    if (!file.regular || !file.path.split('/').every((part) => /^[\w.@+-]+$/.test(part) && part !== '.' && part !== '..')) {
      throw new Error(`unsupported course tree entry ${JSON.stringify(file.path)}: expected a regular file`);
    }
    const to = join(dir, file.path);
    mkdirSync(dirname(to), { recursive: true });
    for (let parent = dirname(to); parent !== dir; parent = dirname(parent)) dirs.add(parent);
    const bytes = file.read();
    writeFileSync(to, bytes, { mode: 0o444, flag: 'wx' });
    blobs[file.path] = createHash('sha256').update(bytes).digest('hex');
  }
  if (seal) for (const path of dirs) chmodSync(path, 0o555);
  return blobs;
}

/** Only the owner of the scratch tree unseals it, and only to dispose of it. */
export function dropCourseTree(dir: string): void {
  if (existsSync(dir) && lstatSync(dir).isDirectory()) {
    const unseal = (path: string): void => {
      chmodSync(path, 0o700);
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory()) unseal(join(path, entry.name));
      }
    };
    unseal(dir);
  }
  rmSync(dir, { recursive: true, force: true });
}
