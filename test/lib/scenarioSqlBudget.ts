import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { scenarioSource } from './scenarioSource';

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
  if (git('ls-tree', base, '--', ALLOWLIST)) return JSON.parse(git('show', `${base}:${ALLOWLIST}`));
  // A base without the gate: the first committed budget, raised only to the raw writes the
  // base's own scenarios already make (main's storage and migration probes written since). The
  // working tree still cannot add a write the base does not have.
  ensureCommit(INITIAL);
  return withBaseWrites(JSON.parse(git('show', `${INITIAL}:${ALLOWLIST}`)), (dir) =>
    git('ls-tree', '-r', '--name-only', base, '--', `test/${dir}`).split('\n').filter((path) => path.endsWith('.ts'))
      .map((path) => [path.slice('test/'.length), git('show', `${base}:${path}`)] as const));
}

function withBaseWrites(initial: WriteBudget, files: (dir: string) => (readonly [string, string])[]): WriteBudget {
  const budget: WriteBudget = structuredClone(initial);
  for (const dir of ['unit', 'integration']) for (const [file, source] of files(dir)) {
    const counts: Record<string, number> = {};
    for (const { key } of scenarioSource(file, source).writes) counts[key] = (counts[key] ?? 0) + 1;
    for (const [key, count] of Object.entries(counts)) {
      budget[file] ??= {};
      budget[file][key] = Math.max(budget[file][key] ?? 0, count);
    }
  }
  return budget;
}

export function budgetIncreases(current: WriteBudget, base: WriteBudget): string[] {
  return Object.entries(current).flatMap(([file, writes]) => Object.entries(writes).flatMap(([key, count]) => {
    const previous = Object.hasOwn(base, file) && Object.hasOwn(base[file], key) ? base[file][key] : 0;
    return !Number.isSafeInteger(count) || count <= 0 || count > previous
      ? [`${file}: ${key} has allowance ${count}, base allows ${previous}`] : [];
  }));
}
