import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Ticketed growth (owner ruling 2026-11-26, R-BTN-30): a list that otherwise only shrinks —
// the pending scenarios, the check:api inventory — may gain an entry that names an open ticket
// building it: a file tickets/<id>.mdx (not tickets/archive/) whose status is not one of these.
export const CLOSED_STATUSES = new Set(['done', 'superseded', 'withdrawn']);
export const TICKET_ID = /^(?:B-[1-9]\d*|R3-\d+[a-z]?\d*)$/;

/** The ids of the open tickets in `<root>/tickets/`, read from each file's frontmatter status. */
export function openTickets(root) {
  const dir = join(root, 'tickets');
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((name) => name.endsWith('.mdx')).flatMap((name) => {
    const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(dir, name), 'utf8'))?.[1] ?? '';
    const status = /^status:\s*(\S+)/m.exec(front)?.[1];
    return status && !CLOSED_STATUSES.has(status) ? [name.slice(0, -4)] : [];
  }));
}

/** Why a new entry naming `ticket` may not be added, or null when it may (`open` given). */
export function growthProblem(ticket, open) {
  if (!open) return 'the list may only shrink';
  if (typeof ticket !== 'string' || !TICKET_ID.test(ticket)) return 'a new entry names the open ticket that builds it';
  if (!open.has(ticket)) return `${ticket} is not an open ticket in tickets/`;
  return null;
}

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

/** Baselines are exact, not ceilings: removing a discrepancy also requires removing its row.
 * With `open` (openTickets), a new row may name an open ticket that builds it; without, none. */
export function exceptionProblems(label, differences, baseline, prior, open) {
  const actual = new Set(differences);
  return [
    ...[...actual].filter((entry) => !Object.hasOwn(baseline, entry)).sort().map((entry) => `${label}: ${entry}`),
    ...Object.keys(baseline).filter((entry) => !actual.has(entry)).sort().map((entry) => `${label}: remove stale exception ${entry}`),
    ...Object.entries(baseline).filter(([, ticket]) => typeof ticket !== 'string' || !TICKET_ID.test(ticket))
      .map(([entry]) => `${label}: invalid ticket for exception ${entry}`),
    ...(prior ? newExceptionProblems(label, baseline, prior, open) : []),
  ];
}

export function newExceptionProblems(label, baseline, prior, open) {
  return Object.keys(baseline).flatMap((entry) => {
    if (!Object.hasOwn(prior, entry)) {
      const why = growthProblem(baseline[entry], open);
      return why ? [`${label}: new exception ${entry}; ${why}`] : [];
    }
    if (baseline[entry] !== prior[entry]) return [`${label}: changed ticket for exception ${entry}`];
    return [];
  });
}
