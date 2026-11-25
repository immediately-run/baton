// remote-slug.ts — `owner/name` of a checkout's `origin` remote, the one git fact both the
// sync defaults (cli.ts) and the CLI's homes (homes.ts, B-121) read. A leaf, so the runner's
// bundle can resolve a named home without the whole of cli.ts beside it: the function, its git
// helper and its failure shape moved here from cli.ts, which re-exports it unchanged.
import { execFileSync } from 'node:child_process';

const git = (root: string, ...a: string[]): string => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim();

interface GitFailure { status?: number | null; stderr?: string | Uint8Array }

/** `owner/name` of a checkout's `origin` remote (an SSH or HTTPS URL, or the proxy's
 * `…/git/owner/name` form) — or any named remote's — or null when the checkout has no such
 * remote — or belongs to no repository at all.
 *
 * B-93: both of those are null and *silent*, and nothing else is. git's own
 * `error: No such remote 'origin'` (exit 2, from a real repository) and `fatal: not a git
 * repository` (exit 128, from a markdown course's home or a fresh scaffold) both read like a
 * failure while the caller goes on to succeed without a slug — the caller that needs one (a
 * forge sync, `--pin`'s self-resolution) says so itself, in its own words. So the child's stderr
 * is captured (`git` above) rather than inherited: a `catch` cannot take back a line git has
 * already written to this process's stderr (review round 1), and capturing is what lets the two
 * quiet cases below be told apart from a git that genuinely broke.
 *
 * Review round 2, nit 7 — the quieting is NOT unconditional: `git` missing from PATH, a
 * `detected dubious ownership` refusal, a corrupt object store or any other exit rethrow the
 * captured stderr, because those are failures the operator must see, and a null slug would make
 * a broken checkout indistinguishable from an origin-less one. Only `git remote get-url`'s own
 * two answers about the absence of a remote go quiet. */
/** `owner/name` of a remote URL — the parse a remote's own URL gets below (the scp form's
 * `git@host:` and the user-less `host:owner/name` and the HTTPS or SSH URL prefix stripped,
 * `.git` dropped, the proxy's `git/` folded away): exported for the caller that holds the
 * URL itself rather than a remote's name (request.ts's PR, opened on the remote the request
 * was pushed to, round 1). */
export const slugOfUrl = (url: string): string =>
  url
    .replace(/^git@[^:]+:/, '')
    .replace(/^(?:https?|ssh):\/\/[^/]+\//, '')
    .replace(/^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9-]+:(?=[^/])/, '')
    .replace(/\.git$/, '')
    .replace(/^git\/(?=[^/]+\/[^/]+$)/, '');

export function remoteSlug(root: string, remote: string = 'origin'): string | null {
  try {
    // The proxy's `…/git/owner/name` form drops its `git/` — only when `owner/name` follows, so an
    // owner named `git` keeps its name.
    return slugOfUrl(git(root, 'remote', 'get-url', remote));
  } catch (e) {
    const { status, stderr } = (e ?? {}) as GitFailure;
    const said = typeof stderr === 'string' ? stderr : stderr ? new TextDecoder().decode(stderr) : (e instanceof Error ? e.message : '');
    // Quiet only the two shapes a repository without an origin can answer with, matched by git's
    // own words under the C catalog (its exit codes are shared — 128 is every fatal error,
    // `dubious ownership` and a corrupt config among them, so the code alone would quiet those
    // too, round 3, 3-r0-1): `git remote get-url`'s "No such remote" (exit 2), and "not a git
    // repository (" — anchored to the parenthesised continuation, so a broken worktree link
    // ("not a git repository: /gone/…", no parenthesis) stays loud (round 4, 4-r1-3).
    const noRemote = status === 2 || said.includes(`No such remote '${remote}'`);
    const noRepository = /not a git repository \(/.test(said);
    if (noRemote || noRepository) return null;
    // Any other failure is the operator's to see, with git's own words (git is not installed, the
    // ownership check refused the checkout, the repository is corrupt): rethrown as an Error
    // carrying the captured stderr, never a quiet null.
    throw new Error(`git remote get-url ${remote} failed in ${root}${status != null ? ` (exit ${status})` : ''}: ${said.trim() || 'no stderr'}`);
  }
}

/** B-113 (§3.1): this checkout's own repository id, as `.baton/baton.json`'s `repos` map names
 *  it — the entry whose forge path is the checkout's origin, both read as `slugOfUrl` reads a
 *  remote (so a `.git` suffix, a URL prefix and case differ nothing), or null when the checkout
 *  has no origin to match or the map names no such entry. A repository naming its own id
 *  qualified (`baton:B-1` in baton's own checkout) is read as it reads the local id alone —
 *  the sync's dependencies read, the claim's dependency walk and the ticket check all ask this
 *  which ids are that spelling (round 1: a `.git` suffix on the map's value, or a map naming
 *  no entry of its own, left the id to be read as another repository's). */
export const ownRepositoryId = (root: string, repos: Record<string, string>): string | null => {
  const slug = remoteSlug(root)?.toLowerCase();
  if (slug == null) return null;
  return Object.entries(repos).find(([, path]) => slugOfUrl(path).toLowerCase() === slug)?.[0] ?? null;
};
