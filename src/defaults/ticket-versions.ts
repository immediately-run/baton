// ticket-versions.ts — the markdown ticket source's opaque versions (B-183, BATON_SPEC §4.2
// R-BTN-74, §4.5 R-BTN-5/R-BTN-34): each live ticket's version is its **file's blob id** at the
// commit the sync posts — a blob id, not the commit's sha, so an unrelated commit changes no
// ticket's version and stales no claim — and the source's `read` is the blob itself, exactly
// what the runner reads today (`git show <snapshot>:<path>`, whose blob id is that version).
// Shared by the CLI's default source (`baton repo sync` with no `.baton/tickets.mjs`) and the
// wrapper `baton repo init --eject tickets` writes, so an ejected copy posts and reads versions
// the same way; the runner also falls back to it for a repository with no source of its own.
import { execFileSync } from 'node:child_process';
import { GIT_NONINTERACTIVE_ENV } from './ticket-state';
import type { TicketsResult } from './tickets-markdown';

/** One git command in `root`, bounded and non-interactive; throws with git's own stderr. */
const git = (root: string, args: string[], timeoutMs = 30_000): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 << 20, env: { ...process.env, ...GIT_NONINTERACTIVE_ENV }, stdio: ['ignore', 'pipe', 'pipe'] });

/** Every file's blob id under `dir` at `rev` (default `HEAD`): one `git ls-tree -r`, parsed —
 * `100644 blob <sha>\t<path>`, the path relative to the repository root. A `dir` the commit does
 * not hold, or a checkout with no commits yet, answers an empty map: a ticket whose file is not
 * at the commit is posted with no version, never a failed sync (the file was read from the tree
 * as today; the version only names what the commit can). */
export function blobIds(root: string, dir: string, rev = 'HEAD', run = git): Map<string, string> {
  let out: string;
  try {
    out = run(root, ['ls-tree', '-r', rev, '--', dir]);
  } catch {
    return new Map();
  }
  const ids = new Map<string, string>();
  for (const line of out.split('\n')) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (m) ids.set(m[2], m[1]);
  }
  return ids;
}

/** Stamp a markdown source's result with its tickets' versions (R-BTN-74: the source decides
 *  what a ticket's version is; the markdown default decides the file's blob id at `rev`): each
 *  live ticket whose file the commit holds gains `version` and `key` (its path, the default).
 *  Returns the same result, stamped. */
export function stampMarkdownVersions(root: string, result: TicketsResult, itemsDir?: string, rev = 'HEAD', run = git): TicketsResult {
  const dir = (itemsDir ?? 'tickets').replace(/\/$/, '');
  const blobs = blobIds(root, dir, rev, run);
  for (const t of result.tickets) t.version = t.path != null ? blobs.get(t.path) ?? '' : '';
  return result;
}

/** The markdown source's `read` (R-BTN-74, B-183): the ticket's blob — `git cat-file blob` of
 *  the version itself, the bytes the posted commit holds — or null when the checkout does not
 *  have the blob (a claim on it releases `stale-board`, §4.5). */
export function readTicketBlob(checkout: string, version: string | null | undefined, run = git): string | null {
  if (typeof version !== 'string' || !/^[0-9a-f]{40}$/.test(version)) return null;
  try {
    return run(checkout, ['cat-file', 'blob', version]);
  } catch {
    return null;
  }
}

/** The markdown default's source declaration as the runner reads it (§4.5): pinned — a ticket
 *  is read at its version, the blob the version names. A repository's own `.baton/tickets.mjs`
 *  exports the same two members; one that exports neither is read as declaring nothing. */
export const MARKDOWN_SOURCE = {
  versions: 'pinned' as const,
  async read(_id: string, o: { version?: string | null; checkout?: string } = {}): Promise<{ version: string; ticket: string | null }> {
    return { version: o.version ?? '', ticket: readTicketBlob(o.checkout ?? process.cwd(), o.version) };
  },
};
