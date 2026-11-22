// links.ts — the forge registry's link shapes (BATON_SPEC §2k, §10.4, §3.1; R3-1262, B-54): forge
// paths, a registration's `web_base`, pull-request URLs, transcript repositories and file pages,
// all built on R-BTN-92's one link rule — which lives in the shared library
// (src/shared/links.mjs), where the renderers check a view's `link` fields with it. Every link
// Baton accepts or draws for a repository is built from, and checked against, the repository's
// `web_base` — never a pinned `https://github.com/`. A `git` repository has no `web_base`, and no
// link.
import { cleanUrl, underWebBase } from '../shared/links.mjs';

import { DEFAULT_FORGE, FORGE_SHAPES, hasPrs, isForge, prSuffix, type Forge } from './forges';
export { FORGES, type Forge } from './forges';

const SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

/** R-BTN-92's forge path: segments of `[A-Za-z0-9_.-]{1,100}`, none `.` or `..` and none ending in
 *  `.git`, two of them on GitHub, Gitea and `git`, two to four on GitLab. */
export function isForgePath(forge: Forge, path: string): boolean {
  const segs = path.split('/');
  const [min, max] = FORGE_SHAPES[forge].depth;
  if (segs.length < min || segs.length > max) return false;
  return segs.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..' && !s.toLowerCase().endsWith('.git'));
}

/** A `web_base` as registration takes it (R-BTN-92): `https://<host>[:<port>]/<forge path>`, with
 *  no userinfo, query or fragment, whose path is `path`. */
export function isWebBase(forge: Forge, webBase: string, path: string): boolean {
  if (!hasPrs(forge)) return false;
  const u = cleanUrl(webBase, false);
  return u !== null && !webBase.endsWith('/') && u.pathname.slice(1).toLowerCase() === path.toLowerCase() && isForgePath(forge, u.pathname.slice(1));
}

/** A pull request's URL on a forge (§10.4): `/pull/<n>` on GitHub, `/pulls/<n>` on Gitea,
 *  `/-/merge_requests/<n>` on GitLab, after the repository's `web_base`. */
export function isPullRequestUrl(forge: Forge, url: string, webBase: string): boolean {
  if (!underWebBase(url, webBase)) return false;
  const rest = new URL(url).pathname.slice(new URL(webBase).pathname.length);
  return hasPrs(forge) && prSuffix(forge).test(rest) && !url.includes('?');
}

/** A `transcript_repos` entry (§6.8): a GitHub `owner/name`, or `<forge>:<web_base>`. */
export function parseTranscriptRepo(entry: string): { forge: Forge; webBase: string } | null {
  const m = /^([^:]+):(https:\/\/.+)$/.exec(entry);
  if (m) {
    const forge = m[1];
    if (!isForge(forge) || !hasPrs(forge)) return null;
    const u = cleanUrl(m[2], false);
    if (!u || m[2].endsWith('/') || !isForgePath(forge, u.pathname.slice(1))) return null;
    return { forge, webBase: m[2] };
  }
  return isForgePath(DEFAULT_FORGE, entry) ? { forge: DEFAULT_FORGE, webBase: `${FORGE_SHAPES[DEFAULT_FORGE].defaultOrigin}/${entry}` } : null;
}

/** R-BTN-113: a leg run's session link — `https`, at most 512 characters, no userinfo,
 *  its host one the instance allowlists (`session_hosts`, an administrator's setting whose
 *  default is `claude.ai`). The reason a link fails, for the drop's log; null when it passes. */
export function sessionLinkWhy(url: string, hosts: readonly string[]): string | null {
  if (url.length > 512) return 'over 512 characters';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'not a URL';
  }
  if (u.protocol !== 'https:') return 'not https';
  if (u.username !== '' || u.password !== '') return 'carries userinfo';
  if (!hosts.includes(u.hostname)) return `its host ${u.hostname} is not among the instance's session_hosts (${hosts.join(', ')})`;
  return null;
}

/** R-BTN-113's `session_hosts`: the hosts whose sessions an instance's people may be linked to,
 *  `BATON_SESSION_HOSTS` as a comma- or JSON-separated list (an administrator's setting; the
 *  default is `claude.ai` alone). */
export const SESSION_HOSTS = {
  default: ['claude.ai'] as const,
  of(config: { BATON_SESSION_HOSTS?: string }): string[] {
    const raw = config.BATON_SESSION_HOSTS;
    if (raw == null || raw === '') return [...SESSION_HOSTS.default];
    let list: string[] | null = null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((h) => typeof h === 'string')) list = parsed as string[];
      // A JSON string — a quoted bare host ('"sessions.example"') or quoted comma-separated
      // hosts — is the list it spells, not raw text to split (whose quotes no URL hostname
      // matches, dropping every session link on such an instance); anything else a JSON value
      // can be falls to the comma-separated reading below.
      else if (typeof parsed === 'string') list = parsed.split(',');
    } catch {
      list = null; // a comma-separated list, below
    }
    const hosts = (list ?? raw.split(',')).map((h) => h.trim().toLowerCase()).filter((h) => h !== '');
    return hosts.length ? [...new Set(hosts)] : [...SESSION_HOSTS.default];
  },
};

/** §6.8: the dashboard's link to a transcript file — its repository's base and its forge's file
 *  path — or null when the entry or path does not pass. */
export function transcriptUrl(entry: string, path: string): string | null {
  const r = parseTranscriptRepo(entry);
  if (!r || !/^[A-Za-z0-9._/-]{1,256}$/.test(path) || path.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return fileUrl(r.forge, r.webBase, 'HEAD', path);
}

/** A file's page in a repository at a branch (the dashboard's ticket links, §14): the `web_base`
 *  and its forge's file path, or null for a `git` repository, which has no pages. */
export function fileUrl(forge: Forge, webBase: string | null, branch: string, path: string): string | null {
  const file = FORGE_SHAPES[forge].blob;
  if (!file || !webBase) return null;
  const url = `${webBase}${file}${branch}/${path}`;
  return underWebBase(url, webBase) ? url : null;
}
