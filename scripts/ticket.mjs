#!/usr/bin/env node
// ticket.mjs — file, claim and move Baton's tickets (tickets/*.mdx) with git as the lock.
//
//   npm run ticket -- new --title "<t>" [--description "<d>"] [--order N] [--repos a,b]
//                         [--depends-on B-1,R3-1249] [--tier T] [--body-file F]
//   npm run ticket -- claim <id>                     available → in-progress
//   npm run ticket -- set <id> <status> [--pr URL]   any live status; --pr adds a pull request
//   npm run ticket -- done <id> [--pr URL]           status done, moved to tickets/archive/
//
// Every command is one commit pushed straight to origin/main, made in a throwaway worktree at
// the freshly fetched main, so the session's own branch and working tree are never touched.
// Git is the lock: if another session pushed first the push is refused, and the command
// refetches and tries again on the new main. `claim` refuses a ticket that is not available or
// whose dependencies are not all done, so two sessions can never both claim one ticket. `new`
// takes the next free B-n on the main it pushes to.
//
// A stopgap until Baton itself claims this repository's tickets (R3-1266): then tickets are
// claimed through Baton, and this file goes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE = process.env.TICKET_REMOTE ?? 'origin';
const BRANCH = process.env.TICKET_BRANCH ?? 'main';
const TRIES = 6;
const LIVE = ['available', 'in-progress', 'in-review', 'deferred', 'deprioritized', 'superseded'];
const ID = /^(R3-\d+[a-z]?\d*|B-\d+)$/;

class Refusal extends Error {}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const today = () => new Date().toISOString().slice(0, 10);

function parseArgs(argv) {
  const flags = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const name = argv[i].slice(2);
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Refusal(`--${name} needs a value`);
      flags[name] = argv[++i];
    } else positional.push(argv[i]);
  }
  return { flags, positional };
}

/** The ticket's file in a checkout: live, or archived. */
function locate(dir, id) {
  for (const sub of ['tickets', 'tickets/archive']) {
    const path = join(dir, sub, `${id}.mdx`);
    if (existsSync(path)) return { path, archived: sub.endsWith('archive') };
  }
  return null;
}

const frontmatter = (text) => parseYaml(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '') ?? {};

/** Replace one top-level frontmatter key's line (a scalar). */
function setKey(text, key, value) {
  const fm = text.match(/^---\n[\s\S]*?\n---\n/)[0];
  const re = new RegExp(`^${key}:.*$`, 'm');
  const next = re.test(fm) ? fm.replace(re, `${key}: ${value}`) : fm.replace(/\n---\n$/, `\n${key}: ${value}\n---\n`);
  return next + text.slice(fm.length);
}

/** Add a PR URL to the frontmatter's `prs` list, once. */
function addPr(text, url) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)) throw new Refusal(`--pr ${url} is not a GitHub pull request URL`);
  if (text.includes(url)) return text;
  const fm = text.match(/^---\n[\s\S]*?\n---\n/)[0];
  const next = /^prs: \[\]$/m.test(fm) ? fm.replace(/^prs: \[\]$/m, `prs:\n  - ${url}`) : fm.replace(/^prs:$/m, `prs:\n  - ${url}`);
  if (next === fm) throw new Refusal('the ticket has no prs list to add to');
  return next + text.slice(fm.length);
}

/** Run `change(worktree)` on a fresh main and push its commit, retrying on a lost race. */
function transact(describe, change) {
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    git(REPO, 'fetch', '-q', REMOTE, BRANCH);
    const dir = mkdtempSync(join(tmpdir(), 'baton-ticket-'));
    try {
      git(REPO, 'worktree', 'add', '-q', '--detach', dir, `${REMOTE}/${BRANCH}`);
      const message = change(dir);
      git(dir, 'add', '-A', 'tickets');
      git(dir, 'commit', '-q', '-m', message);
      try {
        git(dir, 'push', '-q', REMOTE, `HEAD:refs/heads/${BRANCH}`);
        console.log(`✓ ${message.split('\n')[0]} — pushed as ${git(dir, 'rev-parse', '--short', 'HEAD')}`);
        return;
      } catch (e) {
        if (attempt === TRIES) throw new Error(`push refused ${TRIES} times: ${e.stderr ?? e.message}`);
        console.error(`… ${describe}: ${REMOTE}/${BRANCH} moved; retrying on the new head (${attempt}/${TRIES})`);
      }
    } finally {
      try { git(REPO, 'worktree', 'remove', '--force', dir); } catch { rmSync(dir, { recursive: true, force: true }); }
    }
  }
}

function claimOrSet(id, status, pr) {
  if (!ID.test(id)) throw new Refusal(`${id} is not a ticket id`);
  if (status !== 'done' && !LIVE.includes(status)) throw new Refusal(`${status} is not one of ${[...LIVE, 'done'].join(', ')}`);
  transact(`${status} ${id}`, (dir) => {
    const found = locate(dir, id);
    if (!found) throw new Refusal(`${id}: no tickets/${id}.mdx on ${REMOTE}/${BRANCH}`);
    if (found.archived) throw new Refusal(`${id} is archived (done)`);
    let text = readFileSync(found.path, 'utf8');
    const meta = frontmatter(text);
    if (status === 'in-progress' && meta.status !== 'available') {
      throw new Refusal(`${id} is ${meta.status}, not available — someone may hold it`);
    }
    if (status === 'in-progress') {
      const open = (meta.depends_on ?? []).filter((dep) => !locate(dir, dep)?.archived);
      if (open.length) throw new Refusal(`${id} depends on ${open.join(', ')}, not done yet`);
    }
    text = setKey(setKey(text, 'status', status), 'updated', today());
    if (pr) text = addPr(text, pr);
    if (status === 'done') {
      writeFileSync(found.path, text);
      renameSync(found.path, join(dir, 'tickets', 'archive', `${id}.mdx`));
      return `tickets: ${id} done (archived)${pr ? `\n\n${pr}` : ''}`;
    }
    writeFileSync(found.path, text);
    return status === 'in-progress' ? `tickets: claim ${id} (in progress)` : `tickets: ${id} → ${status}${pr ? `\n\n${pr}` : ''}`;
  });
}

function create(flags) {
  const title = flags.title?.trim();
  if (!title) throw new Refusal('new needs --title');
  const deps = (flags['depends-on'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const d of deps) if (!ID.test(d)) throw new Refusal(`--depends-on ${d} is not a ticket id`);
  const body = flags['body-file'] ? readFileSync(flags['body-file'], 'utf8').trim() : '';
  const quote = (s) => JSON.stringify(s);
  transact('new ticket', (dir) => {
    for (const d of deps) if (!locate(dir, d)) throw new Refusal(`--depends-on ${d}: no such ticket on ${REMOTE}/${BRANCH}`);
    const taken = ['tickets', 'tickets/archive'].flatMap((sub) => readdirSync(join(dir, sub)))
      .map((f) => f.match(/^B-(\d+)\.mdx$/)?.[1]).filter(Boolean).map(Number);
    const id = `B-${Math.max(0, ...taken) + 1}`;
    const lines = [
      '---', `title: ${quote(`${id} — ${title}`)}`, `id: ${id}`, 'project: baton', 'status: available', `updated: ${today()}`,
      ...(flags.repos ? ['repos:', ...flags.repos.split(',').map((r) => `  - ${r.trim()}`)] : []),
      'tags:', '  - roadmap-item',
      ...(flags.order ? [`order: ${Number(flags.order)}`] : []),
      ...(flags.tier ? [`tier: ${flags.tier}`] : []),
      `description: ${quote(flags.description ?? title)}`,
      'topics:', '  - baton', 'owns: {}', 'prs: []',
      ...(deps.length ? ['depends_on:', ...deps.map((d) => `  - ${d}`)] : ['depends_on: []']),
      '---', '',
      body || '_(filed; the body follows.)_', '',
    ];
    writeFileSync(join(dir, 'tickets', `${id}.mdx`), lines.join('\n'));
    return `tickets: file ${id} — ${title}`;
  });
}

function main(argv) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  if (command === 'new') return create(flags);
  if (command === 'claim' && positional.length === 1) return claimOrSet(positional[0], 'in-progress');
  if (command === 'set' && positional.length === 2) return claimOrSet(positional[0], positional[1], flags.pr);
  if (command === 'done' && positional.length === 1) return claimOrSet(positional[0], 'done', flags.pr);
  throw new Refusal('usage: ticket new --title T … | claim <id> | set <id> <status> [--pr URL] | done <id> [--pr URL]');
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(`✗ ticket: ${e.message}`);
  process.exit(e instanceof Refusal ? 1 : 2);
}
