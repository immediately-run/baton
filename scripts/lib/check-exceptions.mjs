import { execFileSync } from 'node:child_process';

// The first inventory predates the gate. Use it only until the target branch has the lists.
const BOOTSTRAP = 'ec8a5243cf2a02591b830fed0b5b061472b43825';

export function priorExceptions(root, path) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const github = process.env.GITHUB_ACTIONS === 'true';
  function ensureCommit(sha) {
    try { git('cat-file', '-e', `${sha}^{commit}`); }
    catch (error) {
      if (!github) throw new Error(`exception baseline ${sha} is not present; fetch origin main and its history`, { cause: error });
      // Hosted checkout is depth one. Fetch the immutable parent, not the moving main ref.
      git('fetch', '--no-tags', '--no-write-fetch-head', '--depth=1', 'origin', sha);
    }
  }
  let base = '';
  if (github && ['pull_request', 'push'].includes(process.env.GITHUB_EVENT_NAME)) {
    base = /^parent ([a-f0-9]{40})$/m.exec(git('cat-file', 'commit', 'HEAD').split('\n\n')[0])?.[1] ?? '';
    if (!base) throw new Error('cannot determine the hosted checkout’s first parent for exception checks');
    ensureCommit(base);
  } else {
    // Main's published lists are the ceiling for branch and working-tree edits.
    base = git('for-each-ref', '--format=%(objectname)', 'refs/remotes/origin/main')
      || git('for-each-ref', '--format=%(objectname)', 'refs/heads/main');
  }
  if (!base || !git('ls-tree', base, '--', path)) {
    base = BOOTSTRAP;
    ensureCommit(base);
  }
  return JSON.parse(git('show', `${base}:${path}`));
}

/** Baselines are exact, not ceilings: removing a discrepancy also requires removing its row. */
export function exceptionProblems(label, differences, baseline, prior) {
  const actual = new Set(differences);
  return [
    ...[...actual].filter((entry) => !Object.hasOwn(baseline, entry)).sort().map((entry) => `${label}: ${entry}`),
    ...Object.keys(baseline).filter((entry) => !actual.has(entry)).sort().map((entry) => `${label}: remove stale exception ${entry}`),
    ...Object.entries(baseline).filter(([, ticket]) => typeof ticket !== 'string' || !/^(?:B-[1-9]\d*|R3-\d+[a-z]?\d*)$/.test(ticket))
      .map(([entry]) => `${label}: invalid ticket for exception ${entry}`),
    ...(prior ? newExceptionProblems(label, baseline, prior) : []),
  ];
}

export function newExceptionProblems(label, baseline, prior) {
  return Object.keys(baseline).flatMap((entry) => {
    if (!Object.hasOwn(prior, entry)) return [`${label}: new exception ${entry}; the list may only shrink`];
    if (baseline[entry] !== prior[entry]) return [`${label}: changed ticket for exception ${entry}`];
    return [];
  });
}
