// S-BTN-309: compare the pushed result to integrating the default-branch parents alone.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

type Git = (...args: string[]) => string;
const oid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s) && !/^0+$/.test(s);

export function changedBeyondBase(git: Git, before: string, after: string, base: string): boolean {
  const tree = (ref: string) => git('rev-parse', `${ref}^{tree}`);
  if (tree(before) === tree(after)) return false;
  const isAncestor = (a: string, b: string) => git('merge-base', a, b) === a;
  if (isAncestor(after, base)) return false; // a ref advanced directly to the base
  const start = git('merge-base', before, after);
  let imported: string | undefined;
  for (const line of git('rev-list', '--first-parent', '--parents', `${start}..${after}`).split('\n').reverse()) {
    for (const parent of line.split(' ').slice(2)) {
      if (!isAncestor(parent, base)) continue;
      if (imported && !isAncestor(imported, parent)) {
        if (!isAncestor(parent, imported)) return false; // no single default-branch integration to compare
      } else imported = parent;
    }
  }
  if (!imported) return true;
  let baseline: string;
  try {
    baseline = git('merge-tree', '--write-tree', before, imported).split('\n')[0];
  } catch (e) {
    const failure = e as { status?: number; stdout?: string };
    if (failure.status !== 1 || !oid(failure.stdout?.split('\n')[0])) throw e;
    baseline = failure.stdout!.split('\n')[0];
  }
  return tree(after) !== baseline;
}

/** A private bare object store: do not rewrite refs in the checkout the sync is observing. */
export function pushChangesWork(conn: { host: string; token: string }, repo: string, base: string, before: unknown, after: unknown): boolean {
  if (!oid(before) || !oid(after) || before === after || !/^[a-z0-9.-]+$/i.test(conn.host) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return false;
  const dir = mkdtempSync(join(tmpdir(), 'baton-push-'));
  const header = `Authorization: Basic ${Buffer.from(`x-access-token:${conn.token}`).toString('base64')}`;
  const git: Git = (...args) => execFileSync('git', args, {
    cwd: dir, timeout: 120_000, maxBuffer: 8 << 20, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: header,
      GIT_CONFIG_KEY_1: 'http.followRedirects', GIT_CONFIG_VALUE_1: 'false' },
  }).trim();
  try {
    git('check-ref-format', `refs/heads/${base}`);
    git('init', '--bare', '--quiet');
    git('fetch', '--quiet', '--no-tags', `https://${conn.host}/${repo}.git`, before, after, `refs/heads/${base}:refs/heads/baton-base`);
    return changedBeyondBase(git, before, after, 'refs/heads/baton-base');
  } catch {
    // Do not invent a hand push when the forge cannot serve the old object (e.g. a force
    // push followed by GC) or the merge baseline could not be verified.
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
