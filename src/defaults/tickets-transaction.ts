// Detached worktree archive transaction for the standard create-pr course (S-BTN-232).
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveDelivered } from './pr-verify';
import { readTicketSettings } from './tickets-config';
import { gitText } from './git.mjs';
import { parseFrontmatter } from './tickets-markdown';
import { readItems } from './read-items';

const TICKET_TRIES = 6;
const git = gitText;
const movedOnPush = (detail: string): boolean => /non-fast-forward|fetch first|stale info/.test(detail);

interface Change {
  message: string;
  from: string;
  to: string;
  text: string;
}

/** The message a ticket command's commit lands with (B-16): the command's own message, then the
 *  provenance trailers `TICKET_TRAILERS` holds, after a blank line — the one shape git reads as
 *  trailers, the shape docs' `claim.sh` appends `CLAIM_TRAILERS` in, and the handoff's commit
 *  rule: the agent-provenance trailers, then `Claude-Session` and `Co-Authored-By`. The value is
 *  taken whole — baton computes no trailers of its own and calls nothing to default them
 *  (R3-1268: no `agent-provenance.mjs`, no docs dependency). With `TICKET_REQUIRE_TRAILERS=1` and
 *  the value empty, the message is refused: the agent workflow sets the variable, and a commit
 *  that cannot be attributed is not made. */
function ticketCommitMessage(message: string, trailers: string, requireTrailers = false): string {
  const lines = trailers.trim();
  if (!lines) {
    if (requireTrailers) throw new Error("TICKET_REQUIRE_TRAILERS=1, but TICKET_TRAILERS is empty — set it to the session's provenance lines (the agent-provenance trailers, then Claude-Session and Co-Authored-By), or unset TICKET_REQUIRE_TRAILERS to commit without them");
    return message;
  }
  return `${message}\n\n${lines}`;
}

/** Run `change(worktree)` on a fresh head and push its commit, retrying on a lost race. The
 *  worktree is the mechanism request.ts's `fileRequest` uses, for the reason it uses it: the
 *  caller's branch, HEAD and working tree are never written, a command that fails leaves the
 *  repository exactly as it was, and the commit is made by git, so the repository's own hooks and
 *  signing settings apply to it as to any other. */
function transact(root: string, branch: string, describe: string, change: (dir: string) => Change | { existing: string }): string {
  const trailers = (process.env.TICKET_TRAILERS ?? '').trim();
  const requireTrailers = process.env.TICKET_REQUIRE_TRAILERS === '1';
  for (let attempt = 1; attempt <= TICKET_TRIES; attempt++) {
    git(root, 'fetch', '-q', 'origin', branch);
    const dir = mkdtempSync(join(tmpdir(), 'baton-tickets-'));
    try {
      // The head the push must extend: the commit the fetch just brought, never a stale
      // remote-tracking ref that would be refused as no fast-forward on every try.
      git(root, 'worktree', 'add', '-q', '--detach', dir, 'FETCH_HEAD');
      const changed = change(dir);
      if ('existing' in changed) return changed.existing;
      const { message, from, to, text } = changed;
      mkdirSync(dirname(join(dir, to)), { recursive: true });
      writeFileSync(join(dir, to), text, { flag: 'wx' });
      rmSync(join(dir, from));
      git(dir, '--literal-pathspecs', 'add', '-A', '--', from, to);
      // Preserve the host's provenance trailers (B-16).
      git(dir, 'commit', '-q', '-m', ticketCommitMessage(message, trailers, requireTrailers));
      try {
        git(dir, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
        return git(dir, 'rev-parse', 'HEAD');
      } catch (e) {
        const detail = String((e as { stderr?: string }).stderr || (e as Error).message);
        if (!movedOnPush(detail)) {
          const why = detail.trim().split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^To /.test(l) && !/failed to push some refs/.test(l));
          throw new Error(`${describe}: the push was refused: ${why.join('; ') || 'no reason given'}`);
        }
        if (attempt === TICKET_TRIES) throw new Error(`${describe}: push refused ${TICKET_TRIES} times: ${detail.trim().split('\n').at(-1)}`);
      }
    } finally {
      try {
        git(root, 'worktree', 'remove', '--force', dir);
      } catch {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  throw new Error(`${describe}: no transaction attempt completed`);
}

/** Never descend through a git symlink, including a dangling link at the destination. */
function regularDirs(root: string, path: string, missingOk = false): void {
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error(`invalid ticket directory: ${path}`);
  for (const part of parts) {
    root = join(root, part);
    const stat = lstatSync(root, { throwIfNoEntry: false });
    if (!stat && missingOk) return;
    if (!stat?.isDirectory()) throw new Error(`not a regular ticket directory: ${path}`);
  }
}

/** Let Dibber write the status. A private store gives the selected ticket its canonical name
 *  for Dibber validation without changing its real path or following worktree symlinks. */
function doneText(id: string, target: string, files: ReturnType<typeof readItems>, words: readonly string[]): string {
  if (!/^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(id)) throw new Error(`${id}: invalid archive ticket id`);
  const root = mkdtempSync(join(tmpdir(), 'baton-dibber-archive-'));
  const selected = join(root, 'tickets', `${id}.md`);
  try {
    for (const f of files) {
      if (!/\.mdx?$/i.test(f.path)) continue;
      const dest = f.path === target ? selected : join(root, 'tickets', 'source', f.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, f.text);
    }
    execFileSync(words[0], [...words.slice(1), 'done', id, '--root', root], {
      cwd: root, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_config_ignore_scripts: 'true' },
    });
    const text = readFileSync(selected, 'utf8');
    const meta = parseFrontmatter(text);
    if (meta?.status !== 'done' || meta.id !== id) throw new Error(`${id}: Dibber did not mark the ticket done`);
    return text;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function archiveTicket(root: string, branch: string, id: string, delivered: { path: string; shas: string[]; truncated: boolean; dibber: string[] }): string {
  return transact(root, branch, `${id} → done`, (dir) => {
    const settings = readTicketSettings(dir, dir);
    const items = (settings.items ?? 'tickets').replace(/\/$/, '');
    regularDirs(dir, items, true);
    const files = readItems(dir, items);
    const matches = files.filter((f) => /\.mdx?$/i.test(f.path) && parseFrontmatter(f.text)?.id === id);
    if (!matches.length) throw new Error(`${id}: no ${items}/${id}.mdx on origin/${branch}`);
    if (matches.length !== 1) throw new Error(`${id}: archive cannot identify a single ticket file`);
    const { path, text } = matches[0];
    const archived = path.startsWith('archive/');
    const from = `${items}/${path}`;
    const to = `${items}/archive/${path}`;
    if (delivered.path !== (archived ? `${items}/${path.slice('archive/'.length)}` : from)) {
      throw new Error(`${id}: archive requires the markdown source's current ticket path`);
    }
    const shas = resolveDelivered(delivered.shas, 'HEAD', dir, (_cmd, args, cwd) => git(cwd, ...args));
    const subject = `tickets: ${id} done (archived)`;
    const delivery = `Delivered by: ${shas.join(', ')}`;
    const limitation = 'Delivery evidence incomplete: the legacy end record was truncated; unrecorded commits are not listed.';
    if (archived) {
      if (parseFrontmatter(text)?.status !== 'done') throw new Error(`${id} is archived (done)`);
      // Inspect the addition, not the latest edit. The exact evidence distinguishes our push
      // from a manual archive or another delivery that happened to use the same ticket path.
      const existing = git(dir, '--literal-pathspecs', 'log', '-1', '--first-parent', '--no-renames', '--diff-filter=A', '--format=%H', '--', from);
      if (existing) {
        const [first, , third, , note] = git(dir, 'show', '-s', '--format=%B', existing).split('\n');
        if (first === subject && third === delivery && (note === limitation) === delivered.truncated) return { existing };
      }
      throw new Error(`${id}: the archive does not record this delivery`);
    }
    regularDirs(dir, dirname(to), true);
    if (lstatSync(join(dir, to), { throwIfNoEntry: false })) throw new Error(`${id}: archive destination already exists`);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    if ((frontmatter.match(/^status:/gm) ?? []).length > 1) throw new Error(`${id}: duplicate status fields; archive refused`);
    const message = `${subject}\n\n${delivery}${delivered.truncated ? `\n\n${limitation}` : ''}`;
    const updated = doneText(id, path, files, delivered.dibber);
    return { message, from, to, text: deepenRelativeLinks(updated) };
  });
}

/** A ticket's relative Markdown links rewritten for a file one directory deeper: `](../x` and
 * `](./x` gain a level; absolute URLs, anchors and bare sibling names are left as written. */
function deepenRelativeLinks(text: string): string {
  return text.replace(/\]\((\.\.?\/)/g, (_m, lead: string) => `](${lead === './' ? '../' : '../../'}`);
}
