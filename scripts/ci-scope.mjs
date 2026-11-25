#!/usr/bin/env node
// ci-scope.mjs — whether a change needs the whole suite, or only the ticket checks (owner,
// 2026-11-23: Actions minutes). A change that touches nothing but ticket files — `tickets/<ID>.mdx`
// or `tickets/archive/<ID>.mdx`, the bot's "tickets: …" status commits and a claim's status PRs —
// cannot change what the suite tests: no test reads a ticket file except the safe-render walk,
// which ci.yml still runs for it, beside check:tickets, check:wiki and the ticket-PR view. Every
// other path — the tickets' schema, README, layout and projects included — is code, and so is
// any change this script cannot read: an unknown base, a failed fetch, an empty diff.
//
//   node scripts/ci-scope.mjs BASE HEAD   prints `code=true` or `code=false` (for $GITHUB_OUTPUT)
//                                         and, on stderr, why
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TICKET = /^tickets\/(archive\/)?[A-Za-z][A-Za-z0-9]*-[0-9][A-Za-z0-9]*\.mdx$/;

/** True when `files` is non-empty and every one is a ticket file. */
export const ticketsOnly = (files) => files.length > 0 && files.every((f) => TICKET.test(f));

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** The verdict for BASE..HEAD: `{ code, why }`. Fails toward `code: true`. */
export function scope(base, head, cwd = process.cwd()) {
  if (!base || !head || /^0+$/.test(base)) return { code: true, why: `no base to diff against (${base || 'none'})` };
  // A shallow checkout may not hold the base; fetch it, one commit deep. A base that cannot be
  // fetched (a force-push that dropped it) is a change we cannot read.
  if (git(cwd, 'cat-file', '-e', `${base}^{commit}`).status !== 0) {
    const fetched = git(cwd, 'fetch', '--no-tags', '--depth=1', 'origin', base);
    if (fetched.status !== 0) return { code: true, why: `could not fetch the base ${base.slice(0, 7)}: ${fetched.stderr.trim()}` };
  }
  // --no-renames: a file moved out of tickets/ shows the path it now has, not only the old one
  const diff = git(cwd, 'diff', '--name-only', '--no-renames', base, head);
  if (diff.status !== 0) return { code: true, why: `could not diff ${base.slice(0, 7)}..${head.slice(0, 7)}: ${diff.stderr.trim()}` };
  const files = diff.stdout.split('\n').filter(Boolean);
  if (ticketsOnly(files)) return { code: false, why: `ticket files only (${files.length}): the ticket checks run, the suite does not` };
  const other = files.filter((f) => !TICKET.test(f));
  return { code: true, why: files.length ? `${other.length} non-ticket file(s), e.g. ${other[0]}` : 'an empty diff' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [base, head] = process.argv.slice(2);
  const { code, why } = scope(base, head);
  console.error(`ci-scope: ${why}`);
  console.log(`code=${code}`);
}
