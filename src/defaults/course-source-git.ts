import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GIT_SHA, isSourceBranch } from '../core/validate';
import type { CourseSource } from './course-source';
import type { builtIn } from './courses';
import { CLOSE_TIMEOUT_MS, GIT_NONINTERACTIVE_ENV } from './ticket-state';

/** Fetch one exact branch (not a tag or the remote's HEAD) and load its standard registry.
 * Fetch both resolves and obtains the commit, so a move cannot race a second lookup. */
export async function readBranchSource(src: CourseSource): Promise<{ sha: string; builtIn: typeof builtIn }> {
  if (!isSourceBranch(src.ref)) throw new Error(`invalid course source branch ${JSON.stringify(src.ref)}`);
  const repo = `${src.namespace}/${src.repository}`;
  const env: NodeJS.ProcessEnv = { ...process.env, ...GIT_NONINTERACTIVE_ENV, LC_ALL: 'C' };
  // `-C` does not override Git's repository-local environment (e.g. from a caller's hook).
  const local = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', timeout: CLOSE_TIMEOUT_MS });
  for (const name of local.trim().split('\n')) delete env[name];
  const dir = mkdtempSync(join(tmpdir(), 'baton-course-source-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', timeout: CLOSE_TIMEOUT_MS, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'],
    env,
  }).trim();
  try {
    git('init', '-q', '--template=');
    let sha: string;
    try {
      git('fetch', '-q', '--depth=1', '--no-tags', '--no-recurse-submodules', `https://github.com/${repo}.git`, `refs/heads/${src.ref}`);
      sha = git('rev-parse', '--verify', 'FETCH_HEAD^{commit}');
      if (!GIT_SHA.test(sha)) throw new Error('not a SHA-1 commit');
    } catch {
      throw new Error(`cannot resolve course source branch ${src.ref} in ${repo} — check that it exists and is readable`);
    }
    try {
      git('checkout', '-q', '--detach', sha);
      const { build } = await import('esbuild');
      const outfile = join(dir, 'registry.mjs');
      await build({ entryPoints: [join(dir, 'src/defaults/courses.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
      const registry = await import(pathToFileURL(outfile).href) as { builtIn: typeof builtIn };
      if (typeof registry.builtIn !== 'function') throw new Error('the source exports no standard course registry');
      return { sha, builtIn: registry.builtIn };
    } catch (e) {
      throw new Error(`cannot load course source branch ${src.ref} in ${repo} at ${sha.slice(0, 10)}: ${(e as Error).message}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
