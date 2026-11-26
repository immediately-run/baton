// The sync's live forge facts (R-BTN-96, R-BTN-138, R-BTN-139): read through the registered
// forge's adapter (`./forges/facts`, B-273); `githubFacts` is its old name.
import { DEFAULT_FORGE, FORGE_SHAPES } from '../core/forges';
export { readForgeFacts as githubFacts } from './forges/facts';

/** Whether a remote URL names a plain git repository rather than a forge's (B-182, R-BTN-105): a
 * local path, a `file://` URL, or an `ssh://` URL to any host but the default forge's. Such a home has no
 * PRs of its own to read. An `https://` or scp-form (`git@host:owner/name`) URL is a forge's, as
 * `remoteSlug` reads it. */
export function plainGitRemote(url: string): boolean {
  const u = url.trim();
  if (/^(file:|\/|\.{1,2}[\\/]|~)/.test(u) || /^[A-Za-z]:[\\/]/.test(u)) return true;
  if (/^ssh:\/\//i.test(u)) {
    try {
      return new URL(u).hostname.toLowerCase() !== new URL(FORGE_SHAPES[DEFAULT_FORGE].defaultOrigin).hostname;
    } catch {
      return true;
    }
  }
  return false;
}

/** How long one forge or token call may take before the sync fails (§6.3's bound). */
export const FETCH_TIMEOUT_MS = 30_000;
