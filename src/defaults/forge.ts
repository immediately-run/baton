// forge.ts — the request command's forge adapters (B-174, BATON_SPEC §5.8 R-BTN-131, §12.8
// R-BTN-180): where a forge refuses `baton ticket request`'s push to the default branch because
// the branch is protected, the CLI decides that by the forge's answer — the refusal's own words,
// matched per forge — and never by reading Baton's policy (R-BTN-180's request bullet). The
// same adapters open the request's PR with the caller's forge credential, the token the CLI
// already reads for a forge (GITHUB_TOKEN, GITLAB_TOKEN, GITEA_TOKEN; R-BTN-138, R-BTN-140).
//
// A leaf, like remote-slug.ts: the request command (request.ts) is bundled alone, and neither
// the sync's fact adapter (cli.ts) nor the management CLI (cli/baton.mjs) should come with it.
// The forge knowledge itself is three small tables: which refusals say "protected", which host
// serves a forge's API, and how a PR is opened there.

/** The forges the request command has an adapter for (R-BTN-92): `git` has none — a plain git
 *  server's refusals are never read as protection, only reported in git's own words (R-BTN-74). */
export type PrForge = 'github' | 'gitlab' | 'gitea';

/** The forges `--forge` may name: the three with an adapter, and `git`, which names none. */
export const NAMED_FORGES = ['github', 'gitlab', 'gitea', 'git'] as const;

/** How long the one PR-open call may take (the sync's own forge calls' bound, cli.ts). */
const FETCH_TIMEOUT_MS = 30_000;

/** A remote URL's host, lowercased — an `https://` or `ssh://` URL's, or the scp form's
 *  (`git@host:owner/name`); null for a local path or `file://` remote, which is no forge's.
 *  The local forms are plainGitRemote's (cli.ts): the two must agree on what is no forge. */
export function hostOf(url: string): string | null {
  const u = url.trim();
  if (/^(file:|\/|\.{1,2}[\\/]|~)/.test(u) || /^[A-Za-z]:[\\/]/.test(u)) return null;
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    // not a URL: the scp form, or nothing this command can name a host from
    const m = /^[^@/]+@([^/:]+):/.exec(u);
    return m ? m[1].toLowerCase() : null;
  }
}

/** The adapter that decides the request command's protected-branch fallback (R-BTN-131): the one
 *  `--forge` names (`git` names none — a plain git server has no adapter), else `github` where
 *  the checkout's origin is on github.com. Any other origin — GitLab, Gitea, a local path —
 *  keeps no adapter until `--forge` names it, and its refusals are git's words alone. */
export function requestForge(named: string | undefined, originUrl: string | null): PrForge | null {
  if (named === 'git') return null;
  if (named != null) return named as PrForge;
  return originUrl != null && hostOf(originUrl) === 'github.com' ? 'github' : null;
}

/** The env variable holding a forge's credential: the caller's own token, as the CLI reads it
 *  for every forge (R-BTN-138's `baton admin repo add`, R-BTN-140's `--code-repos`). */
export const tokenOf = (forge: PrForge): string => `${forge.toUpperCase()}_TOKEN`;

/** Whether `detail` — git's own stderr from the refused push — is `forge` refusing it because
 *  the branch is protected (R-BTN-131): each forge recognised by its own words.
 *  - GitHub's `GH006` is the protected-branch refusal, every variant of it. `GH013` is its
 *    ruleset code: the rulesets governing how a branch may be updated — a pull request
 *    required, a check required — are answered by a PR, and one that does not, secret push
 *    protection, names secrets in its refusal and is never matched.
 *  - GitLab's and Gitea's own protected-branch messages, verbatim enough to match.
 *  Anything else — a hook's own words, a permission refusal, a `git` server that happens to say
 *  one of these phrases — is the operator's, reported in git's words (R-BTN-74). */
export function protectedRefusal(forge: PrForge, detail: string): boolean {
  if (forge === 'github') {
    if (/GH006/i.test(detail)) return true;
    return /GH013/i.test(detail) && !/secret/i.test(detail);
  }
  if (forge === 'gitlab') return /not allowed to push code to protected branches/i.test(detail);
  return /not allowed to push to protected branch/i.test(detail);
}

/** One forge's REST origin for `host` (cli/baton.mjs's forgeApi, kept here so the leaf needs no
 *  import): GitHub's own is api.github.com, an Enterprise host serves `/api/v3`, GitLab
 *  `/api/v4`, Gitea `/api/v1`. */
export function forgeApi(forge: PrForge, host: string): string {
  if (forge === 'github') return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  return `https://${host}/api/v${forge === 'gitlab' ? 4 : 1}`;
}

/** The request's PR, as `openRequestPr` opens it: from the side branch the protected refusal
 *  pushed, onto the default branch the push was refused on, titled with the commit's subject. */
export interface RequestPr {
  forge: PrForge;
  /** The origin's host (the API follows it; a host-less origin falls back to the forge's own). */
  host: string;
  /** The repository's forge path (`owner/name`). */
  repo: string;
  /** The branch the request landed on: `baton-request/<ID>`. */
  head: string;
  /** The default branch the push was refused on. */
  base: string;
  title: string;
}

/** Open the request's PR with the caller's forge credential and answer its URL — one request,
 *  no paging: a PR is one object on every forge. A refusal is one line naming the forge, its
 *  answer, and the branch that is pushed and waiting. */
export async function openRequestPr(pr: RequestPr, token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const base = forgeApi(pr.forge, pr.host);
  // GitLab names its PRs merge requests and identifies the project by its URL-encoded path;
  // GitHub and Gitea both take `POST /repos/{repo}/pulls`.
  const [url, body] =
    pr.forge === 'gitlab'
      ? [`${base}/projects/${encodeURIComponent(pr.repo)}/merge_requests`, { title: pr.title, source_branch: pr.head, target_branch: pr.base }]
      : [`${base}/repos/${pr.repo}/pulls`, { title: pr.title, head: pr.head, base: pr.base }];
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'baton-cli' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const answered = (await res.json().catch(() => null)) as { html_url?: unknown; web_url?: unknown; message?: unknown; error?: unknown; errors?: unknown } | null;
  const said = answered?.[pr.forge === 'gitlab' ? 'web_url' : 'html_url'];
  if (!res.ok || typeof said !== 'string') {
    const why = [answered?.message, ...(Array.isArray(answered?.errors) ? (answered?.errors as unknown[]) : [])].filter((x) => x != null).map(String).join('; ');
    throw new Error(`${pr.forge} (${pr.host}) answered ${res.status} opening the PR from ${pr.head}: ${why || 'no reason given'} — the request is pushed on ${pr.head}; open the PR yourself`);
  }
  return said;
}
