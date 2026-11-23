import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const ALLOWLIST = 'test/fixtures/scenario-sql-allowlist.json';
export type WriteBudget = Record<string, Record<string, number>>;

// Only needed while the base predates B-279. Pin the first committed budget, never the
// working tree's copy, so even the PR introducing the gate cannot raise the counts.
const INITIAL = '10d471a8fd1dd92f07f807f7a77dec5d1b808b4b';

export function baseWriteBudget(cwd: string): WriteBudget {
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 }).trim();
  const name = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let base = 'refs/remotes/origin/main';
  if (eventPath && (name === 'pull_request' || name === 'push')) {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    base = name === 'pull_request' ? event.pull_request.base.sha : event.before;
    if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('Missing GitHub event base SHA');
  }

  function ensureCommit(ref: string) {
    if (spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd }).status === 0) return;
    // Actions runs the suite in a depth-one checkout. Fetch only the immutable commit needed.
    if (/^[0-9a-f]{40}$/.test(ref)) git('fetch', '--quiet', '--no-tags', '--depth=1', 'origin', ref);
    else throw new Error(`Missing ${ref}; run git fetch origin main before checking the SQL budget`);
  }

  ensureCommit(base);
  if (!git('ls-tree', base, '--', ALLOWLIST)) base = INITIAL;
  ensureCommit(base);
  return JSON.parse(git('show', `${base}:${ALLOWLIST}`));
}

export function budgetIncreases(current: WriteBudget, base: WriteBudget): string[] {
  return Object.entries(current).flatMap(([file, writes]) => Object.entries(writes).flatMap(([key, count]) => {
    const previous = Object.hasOwn(base, file) && Object.hasOwn(base[file], key) ? base[file][key] : 0;
    return !Number.isSafeInteger(count) || count <= 0 || count > previous
      ? [`${file}: ${key} has allowance ${count}, base allows ${previous}`] : [];
  }));
}
