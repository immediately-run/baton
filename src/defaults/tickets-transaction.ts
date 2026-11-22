// The ticket commands' shared worktree transaction and markdown archive write.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveDelivered } from './pr-verify';
import { ticketsBranch } from './ticket-state';
import { accepts, GITHUB_PR, readTicketSettings, type TicketSettings } from './tickets-config';
import { addPr, setKey } from './tickets-file';
import { parseFrontmatter } from './tickets-markdown';
import { readItems } from './read-items';

/** The most tries one command makes when the default branch moves under it: the stopgap's. */
export const TICKET_TRIES = 6;

export const git = (root: string, ...a: string[]): string =>
  execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim();

export const today = (): string => new Date().toISOString().slice(0, 10);

/** git's own words for a push refused because the branch moved — the one refusal a re-read fixes;
 *  a hook's or a protected branch's says `[remote rejected]`, and no re-read fixes that. */
const movedOnPush = (detail: string): boolean => /non-fast-forward|fetch first|stale info/.test(detail);

export const detailOf = (e: unknown): string => {
  const err = e as { status?: unknown; stderr?: string | Uint8Array; message?: string };
  return typeof err?.stderr === 'string' ? err.stderr : err?.stderr ? new TextDecoder().decode(err.stderr) : (err?.message ?? String(e));
};

export interface TicketTransactionIo {
  log?: (line: string) => void;
  warn?: (line: string) => void;
  /** The day `updated:` and `## Status` carry, for a test's fixed day. */
  date?: string;
  /** The remote (`origin`) and the branch (`origin/HEAD`, else `main`). */
  remote?: string;
  branch?: string;
  /** `new`'s own line, printed by the command rather than `transact`'s. */
  quiet?: boolean;
  /** The provenance trailers every commit's message carries (B-16): a stand-in for
   *  `TICKET_TRAILERS`. */
  trailers?: string;
  /** `TICKET_REQUIRE_TRAILERS=1` (B-16): a stand-in for the flag — refuse empty trailers. */
  requireTrailers?: boolean;
}

/** What one try of a command does in the worktree, and the commit's subject it lands with. */
interface Change {
  /** The commit's message; its first line is printed on success. */
  message: string;
  /** The files to write, relative to the worktree root. */
  write: { path: string; text: string }[];
  /** Files to move, relative to the worktree root: committed as one delete and one add. */
  move: { from: string; to: string }[];
}

/** The message a ticket command's commit lands with (B-16): the command's own message, then the
 *  provenance trailers `TICKET_TRAILERS` holds, after a blank line — the one shape git reads as
 *  trailers, the shape docs' `claim.sh` appends `CLAIM_TRAILERS` in, and the handoff's commit
 *  rule: the agent-provenance trailers, then `Claude-Session` and `Co-Authored-By`. The value is
 *  taken whole — baton computes no trailers of its own and calls nothing to default them
 *  (R3-1268: no `agent-provenance.mjs`, no docs dependency). With `TICKET_REQUIRE_TRAILERS=1` and
 *  the value empty, the message is refused: the agent workflow sets the variable, and a commit
 *  that cannot be attributed is not made. */
export function ticketCommitMessage(message: string, trailers: string, requireTrailers = false): string {
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
export function transact(root: string, io: TicketTransactionIo, describe: string, change: (dir: string) => Change | { existing: string }): string {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const warn = io.warn ?? ((l: string) => process.stderr.write(`${l}\n`));
  const remote = io.remote ?? 'origin';
  const branch = io.branch ?? ticketsBranch(root, null);
  // B-16: the trailers every commit this command lands carry, read once before the loop; the
  // refusal — required and empty — comes of ticketCommitMessage, at the commit itself.
  const trailers = (io.trailers ?? process.env.TICKET_TRAILERS ?? '').trim();
  const requireTrailers = io.requireTrailers ?? process.env.TICKET_REQUIRE_TRAILERS === '1';
  for (let attempt = 1; attempt <= TICKET_TRIES; attempt++) {
    git(root, 'fetch', '-q', remote, branch);
    const dir = mkdtempSync(join(tmpdir(), 'baton-tickets-'));
    try {
      // The head the push must extend: the commit the fetch just brought, never a stale
      // remote-tracking ref that would be refused as no fast-forward on every try.
      git(root, 'worktree', 'add', '-q', '--detach', dir, 'FETCH_HEAD');
      const changed = change(dir);
      if ('existing' in changed) return changed.existing;
      const { message, write, move } = changed;
      const written = new Set(write.map((w) => w.path));
      for (const m of move) {
        mkdirSync(dirname(join(dir, m.to)), { recursive: true });
        // A move into a path this command also wrote has its content there already: the old file
        // is the delete, and the write the add.
        if (written.has(m.to)) rmSync(join(dir, m.from), { force: true });
        else renameSync(join(dir, m.from), join(dir, m.to));
      }
      for (const w of write) {
        mkdirSync(dirname(join(dir, w.path)), { recursive: true });
        writeFileSync(join(dir, w.path), w.text);
      }
      // The paths this command touched, and nothing else: the worktree is a fresh checkout of
      // the fetched head, so nothing else in it is this command's to commit.
      git(dir, '--literal-pathspecs', 'add', '-A', '--', ...new Set([...write.map((w) => w.path), ...move.map((m) => m.from)]));
      // Nothing to record is a lost race too — a peer pushed this same change first — so it is
      // the next try's, not a failure.
      // Asked, not parsed from a failure: `git diff --cached --quiet` exits 0 when the index
      // matches HEAD, which is the lost race this command's change losing to a peer's identical one
      // looks like — a rewrite that lands the same bytes.
      const staged = (() => {
        try {
          git(dir, 'diff', '--cached', '--quiet');
          return false;
        } catch {
          return true;
        }
      })();
      if (!staged) {
        if (attempt === TICKET_TRIES) throw new Error(`${describe}: nothing to commit after ${TICKET_TRIES} tries`);
        warn(`… ${describe}: nothing to commit — a peer landed the same change; retrying (${attempt}/${TICKET_TRIES})`);
        continue;
      }
      // The message git commits is the command's with its trailers (B-16); the success line
      // below prints the command's own subject, which the trailers never touch.
      git(dir, 'commit', '-q', '-m', ticketCommitMessage(message, trailers, requireTrailers));
      try {
        git(dir, 'push', '-q', remote, `HEAD:refs/heads/${branch}`);
        if (!io.quiet) log(`✓ ${message.split('\n')[0]} — pushed as ${git(dir, 'rev-parse', '--short', 'HEAD')}`);
        return git(dir, 'rev-parse', 'HEAD');
      } catch (e) {
        const detail = detailOf(e);
        if (!movedOnPush(detail)) {
          const why = detail.trim().split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^To /.test(l) && !/failed to push some refs/.test(l));
          // The refusal's own words ride on the error: B-176's `--direct` reads them to tell a
          // protected branch's refusal (another landing) from the operator's (none).
          const refusal = new Error(`${describe}: the push was refused: ${why.join('; ') || 'no reason given'}`);
          (refusal as Error & { detail?: string }).detail = detail;
          throw refusal;
        }
        if (attempt === TICKET_TRIES) throw new Error(`${describe}: push refused ${TICKET_TRIES} times: ${detail.trim().split('\n').at(-1)}`);
        warn(`… ${describe}: ${remote}/${branch} moved; retrying on the new head (${attempt}/${TICKET_TRIES})`);
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

/** The settings of the head a command is about to write: read in the worktree, never in the
 *  caller's checkout, so a branch the caller stands on cannot change what lands (B-98's lesson). */
export const settingsAt = (dir: string, remote: string, branch: string): TicketSettings => readTicketSettings(dir, `${remote}/${branch}`);

/** A ticket's file in the worktree, in the items folder and in its `archive/`: `locate`'s two
 *  names, asked of the filesystem the worktree is, never the process's checkout. */
export const fileAt = (dir: string): ((path: string) => boolean) => (path) => existsSync(join(dir, path));

export const acceptedList = (settings: TicketSettings): string => Object.keys(settings.prefixes).sort().map((p) => `${p}…`).join(', ');

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

/** The one archive transaction, used by tickets done and create-pr's archive close. */
export function archiveTicket(root: string, io: TicketTransactionIo, id: string, evidence: { pr?: string; delivered?: { path: string; shas: string[] } }): string {
  const { pr, delivered } = evidence;
  if (pr != null && !GITHUB_PR.test(pr)) throw new Error(`--pr ${pr} is not a GitHub pull request URL`);
  const date = io.date ?? today();
  const remote = io.remote ?? 'origin';
  const branch = io.branch ?? ticketsBranch(root, null);
  return transact(root, io, `${id} → done`, (dir) => {
    const settings = settingsAt(dir, remote, branch);
    if (!delivered && !accepts(settings, id)) throw new Error(`${id} is not a ticket id of this repository — its ids are ${acceptedList(settings)}`);
    const items = (settings.items ?? 'tickets').replace(/\/$/, '');
    regularDirs(dir, items, true);
    const matches = readItems(dir, items).filter((f) => /\.mdx?$/i.test(f.path) && parseFrontmatter(f.text)?.id === id);
    if (!matches.length) throw new Error(`${id}: no ${items}/${id}.mdx on ${remote}/${branch}`);
    if (matches.length !== 1) throw new Error(`${id}: archive cannot identify a single ticket file`);
    let { path, text } = matches[0];
    const archived = path.startsWith('archive/');
    const from = `${items}/${path}`;
    const to = `${items}/archive/${path}`;
    if (delivered && delivered.path !== (archived ? `${items}/${path.slice('archive/'.length)}` : from)) {
      throw new Error(`${id}: archive requires the markdown source's current ticket path`);
    }
    const shas = delivered ? resolveDelivered(delivered.shas, 'HEAD', dir, (_cmd, args, cwd) => git(cwd, ...args)) : [];
    const subject = `tickets: ${id} done (archived)`;
    const delivery = `Delivered by: ${shas.join(', ')}`;
    if (archived) {
      if (!delivered || parseFrontmatter(text)?.status !== 'done') throw new Error(`${id} is archived (done)`);
      // Inspect the addition, not the latest edit. The exact evidence distinguishes our push
      // from a manual archive or another delivery that happened to use the same ticket path.
      const existing = git(dir, '--literal-pathspecs', 'log', '-1', '--first-parent', '--no-renames', '--diff-filter=A', '--format=%H', '--', from);
      if (existing) {
        const [first, , third] = git(dir, 'show', '-s', '--format=%B', existing).split('\n');
        if (first === subject && third === delivery) return { existing };
      }
      throw new Error(`${id}: the archive does not record this delivery`);
    }
    regularDirs(dir, dirname(to), true);
    if (lstatSync(join(dir, to), { throwIfNoEntry: false })) throw new Error(`${id}: archive destination already exists`);
    text = setKey(setKey(text, 'status', 'done'), 'updated', date);
    if (pr) text = addPr(text, pr);
    const body = shas.length ? `\n\n${delivery}` : pr ? `\n\n${pr}` : '';
    return { message: `${subject}${body}`, write: [{ path: to, text: deepenRelativeLinks(text) }], move: [{ from, to }] };
  });
}

/** A ticket's relative Markdown links rewritten for a file one directory deeper: `](../x` and
 * `](./x` gain a level; absolute URLs, anchors and bare sibling names are left as written. */
export function deepenRelativeLinks(text: string): string {
  return text.replace(/\]\((\.\.?\/)/g, (_m, lead: string) => `](${lead === './' ? '../' : '../../'}`);
}
