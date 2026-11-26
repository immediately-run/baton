/** A remote URL's host, lowercased — an `https://` or `ssh://` URL's, or the scp form's
 *  (`git@host:owner/name`, and the user-less `host:owner/name`); null for a local path or
 *  `file://` remote, which is no forge's. An `http(s)` URL's explicit port rides along
 *  (`git.example:8443` — it serves the forge's API as it serves the repository); an `ssh://`
 *  URL's names the ssh channel, never the API's origin, so it does not.
 *  The local forms are plainGitRemote's (facts.ts): the two must agree on what is no forge. */
export function hostOf(url: string): string | null {
  const u = url.trim();
  if (/^(file:|\/|\.{1,2}[\\/]|~)/.test(u) || /^[A-Za-z]:[\\/]/.test(u)) return null;
  try {
    const parsed = new URL(u);
    // A parse that yields no hostname is the scp form's colon read as a scheme
    // (`github.com:owner/repo` parses as protocol `github.com:`): fall through, below.
    if (parsed.hostname) return (parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.host : parsed.hostname).toLowerCase();
  } catch {
    // not a URL: the scp form, or nothing this command can name a host from
  }
  const withUser = /^[^@/]+@([^/:]+):/.exec(u);
  if (withUser) return withUser[1].toLowerCase();
  // The user-less scp form (`github.com:owner/repo`): a host with a dot, so a bare word before
  // a colon (a scheme, a drive letter's remains) is not read as one.
  const userLess = /^([a-z0-9][a-z0-9.-]*\.[a-z0-9-]+):/i.exec(u);
  return userLess ? userLess[1].toLowerCase() : null;
}

/** `owner/name` of a remote URL — the parse a remote's own URL gets below (the scp form's
 * `git@host:` and the user-less `host:owner/name` and the `https://host/` prefix stripped,
 * `.git` dropped, the proxy's `git/` folded away): exported for the caller that holds the
 * URL itself rather than a remote's name (request.ts's PR, opened on the remote the request
 * was pushed to, round 1). */
export const slugOfUrl = (url: string): string =>
  url
    .replace(/^git@[^:]+:/, '')
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9-]+:(?=[^/])/, '')
    .replace(/\.git$/, '')
    .replace(/^git\/(?=[^/]+\/[^/]+$)/, '');
