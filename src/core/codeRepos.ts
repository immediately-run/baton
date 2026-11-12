// codeRepos.ts — the owners' code repositories (BATON_SPEC §3.4 R-BTN-140, B-182): the store's
// side of the list each home's owners write. An entry names its own forge and host — omitted,
// both are the home's; on a `git` home both are required — and Baton stores `{path, forge, host,
// repo_id, owner_id, web_base}`, the ids read by the CLI from that forge's API (Baton never
// fetches) and re-judged by the fact adapter at every read, so a re-created path never gains
// reach. The paths are unique case-insensitively among the home's path and every entry,
// whatever the host, which is what keeps `owner/name` a name that resolves without a host
// (R-BTN-92). Pure first: `checkCodeRepos` and `checkPushers` hold no I/O; the reads below them
// are the store's side, the way registry.ts splits its checks from its store.
import { BatonError } from './http';
import { FORGE_HOST, FORGE_ID } from './validate';
import { isForgePath, isWebBase, type Forge } from './links';
import type { Store } from './ports';

/** A forge a code repository may sit on (R-BTN-140): a `git` code repository has no PR facts to
 *  read and is refused, so the home's `git` is not among these. */
export const CODE_FORGES = ['github', 'gitlab', 'gitea'] as const;
export type CodeForge = (typeof CODE_FORGES)[number];

/** One code repository as Baton stores it (R-BTN-140) — and as the observation hands it to the
 *  sync, ids and web_base with it. */
export interface CodeRepo {
  path: string;
  forge: CodeForge;
  host: string;
  repo_id: string;
  owner_id: string;
  web_base: string;
}

/** A stored row's own columns, `added_by`/`added_at` beside them. */
interface CodeRepoRow extends CodeRepo {
  repository_id: string;
  added_by: string;
  added_at: number;
}

/** One `pushers` entry as the owners write it (R-BTN-139): `{host?, id}` — without a host, the
 *  home's; on a `git` home a host-less entry is refused. */
export interface PusherEntry {
  host?: string;
  id: string;
}

/** What a home's own forge and host are, for defaulting an entry's omitted `forge` and `host`:
 *  a forge home's host is its `web_base`'s authority; a `git` home has neither. */
export interface HomeForge {
  forge: Forge;
  host: string | null;
  github: string;
}

const bad = (field: string, why: string): never => {
  throw new BatonError('invalid-params', `${field}: ${why}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The most entries one `code_repos` list, and one `pushers` list, holds. */
export const CODE_REPOS_MAX = 16;
export const PUSHERS_MAX = 64;

/** A `code_repos` list as `PUT /v1/owner/{repository}/settings` carries it: each entry
 *  `{path, forge?, host?, repo_id, owner_id}` — the ids read by the CLI (R-BTN-138's way), never
 *  resolved here. Omitted `forge` and `host` are the home's; on a `git` home both are required,
 *  and `forge: git` is refused (no PR facts to read). A path — whatever its host — is unique
 *  case-insensitively among the home's path and every entry, so `owner/name` keeps resolving
 *  without a host (R-BTN-92). Returns the entries as stored, `web_base` derived from the host
 *  and path. */
export function checkCodeRepos(v: unknown, home: HomeForge, at = 'code_repos'): CodeRepo[] {
  if (!Array.isArray(v) || v.length > CODE_REPOS_MAX) bad(at, `must be a list of at most ${CODE_REPOS_MAX} code repositories`);
  const out: CodeRepo[] = [];
  const seen = new Map<string, number>();
  const put = (path: string, i: number) => {
    const key = path.toLowerCase();
    if (seen.has(key)) bad(`${at}[${i}].path`, `repeats ${path}, already entry ${seen.get(key)} — a code_repos path is unique case-insensitively, whatever its host (R-BTN-92)`);
    seen.set(key, i);
  };
  put(home.github, -1); // the home's own path holds its name across every host
  for (const [i, raw] of (v as unknown[]).entries()) {
    const e = isObj(raw) ? raw : bad(`${at}[${i}]`, 'must be {path, forge?, host?, repo_id, owner_id}');
    const where = `${at}[${i}]`;
    for (const k of Object.keys(e)) if (!['path', 'forge', 'host', 'repo_id', 'owner_id'].includes(k)) bad(`${where}.${k}`, 'unknown field');
    // B-182: omitted forge and host are the home's; a git home has none to default to. An
    // explicit `git` is refused on any home: a git code repository has no PR facts to read.
    const forge = e.forge === undefined ? home.forge : e.forge;
    if (e.forge === undefined && home.forge === 'git') {
      bad(`${where}.forge`, "a git home names no forge of its own: each entry's forge is required, one of github, gitlab, gitea");
    }
    if (forge === 'git') {
      bad(`${where}.forge`, 'a git code repository has no PR facts to read — one of github, gitlab, gitea');
    }
    if (!(CODE_FORGES as readonly string[]).includes(forge as string)) {
      bad(`${where}.forge`, `must be one of ${CODE_FORGES.join(', ')}`);
    }
    const host = e.host === undefined ? home.host : e.host;
    if (typeof host !== 'string' || !FORGE_HOST.test(host)) {
      bad(`${where}.host`, home.forge === 'git' && e.host === undefined
        ? "a git home names no host of its own: each entry's host is required"
        : 'must be a lowercased DNS name with optional port');
    }
    const path = typeof e.path === 'string' && isForgePath(forge as Forge, e.path) ? e.path : bad(`${where}.path`, `must be a ${forge} forge path`);
    put(path, i);
    const repoId = typeof e.repo_id === 'string' && FORGE_ID.test(e.repo_id) ? e.repo_id : bad(`${where}.repo_id`, 'must be the forge repository id as a decimal string — `baton owner settings` reads it');
    const ownerId = typeof e.owner_id === 'string' && FORGE_ID.test(e.owner_id) ? e.owner_id : bad(`${where}.owner_id`, 'must be the forge owner id as a decimal string — `baton owner settings` reads it');
    const webBase = `https://${host}/${path}`;
    if (!isWebBase(forge as Forge, webBase, path)) bad(`${where}.host`, `with ${path} does not spell the entry's web_base`);
    out.push({ path, forge: forge as CodeForge, host: host as string, repo_id: repoId, owner_id: ownerId, web_base: webBase });
  }
  return out;
}

/** A `pushers` list as the settings carry it (R-BTN-139): `{host?, id}` entries — null clears
 *  the setting — returned normalized with every host filled in: a host-less entry takes the
 *  home's, and on a `git` home one is refused (there is no host to default to). */
export function checkPushers(v: unknown, home: HomeForge, at = 'pushers'): { host: string; id: string }[] {
  if (v === null) return [];
  if (!Array.isArray(v) || v.length === 0 || v.length > PUSHERS_MAX) bad(at, `must be null or a list of 1–${PUSHERS_MAX} {host?, id} entries`);
  const out: { host: string; id: string }[] = [];
  for (const [i, raw] of (v as unknown[]).entries()) {
    const e = isObj(raw) ? raw : bad(`${at}[${i}]`, 'must be {host?, id}');
    const where = `${at}[${i}]`;
    for (const k of Object.keys(e)) if (!['host', 'id'].includes(k)) bad(`${where}.${k}`, 'unknown field');
    const host = e.host === undefined ? home.host : e.host;
    if (typeof host !== 'string' || !FORGE_HOST.test(host)) {
      bad(`${where}.host`, home.forge === 'git' && e.host === undefined ? 'a git home names no host of its own: a pushers entry on it needs one' : 'must be a lowercased DNS name with optional port');
    }
    const id = typeof e.id === 'string' && FORGE_ID.test(e.id) ? e.id : bad(`${where}.id`, 'must be an immutable forge user id as a decimal string');
    out.push({ host: host as string, id });
  }
  if (new Set(out.map((p) => `${p.host}\u0000${p.id}`)).size !== out.length) bad(at, 'names a host and id twice');
  return out;
}

// ── the store's side ─────────────────────────────────────────────────────────────────────

const rowsOf = (store: Store, repository: string): CodeRepoRow[] =>
  store.exec<CodeRepoRow>('SELECT repository_id, path, forge, host, repo_id, owner_id, web_base, added_by, added_at FROM code_repos WHERE repository_id = ? ORDER BY path', repository).toArray() as CodeRepoRow[];

/** The home's code repositories as the observation hands them to the sync (R-BTN-140): the whole
 *  list with its ids and web_base, ready to be read on each entry's own forge. */
export function codeReposOf(store: Store, repository: string): CodeRepo[] {
  return rowsOf(store, repository).map(({ path, forge, host, repo_id, owner_id, web_base }) => ({ path, forge, host, repo_id, owner_id, web_base }));
}

/** Replace the home's list in the caller's transaction, keeping an existing entry's `added_by`
 *  and `added_at` (a re-written list keeps the ids of the paths it keeps, and their history). */
export function writeCodeRepos(store: Store, repository: string, entries: CodeRepo[], addedBy: string, now: number): void {
  const old = new Map(rowsOf(store, repository).map((r) => [r.path.toLowerCase(), r]));
  store.exec('DELETE FROM code_repos WHERE repository_id = ?', repository);
  for (const e of entries) {
    const was = old.get(e.path.toLowerCase());
    store.exec('INSERT INTO code_repos (repository_id, path, forge, host, repo_id, owner_id, web_base, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      repository, e.path, e.forge, e.host, e.repo_id, e.owner_id, e.web_base, was?.added_by ?? addedBy, was?.added_at ?? now);
  }
}

/** The owners' `pushers`, normalized as stored (R-BTN-139): `[{host, id}]`, none while unset. */
export function pushersOf(store: Store, repository: string): { host: string; id: string }[] {
  const raw = store.exec<{ pushers: string | null }>('SELECT pushers FROM repositories WHERE id = ?', repository).toArray()[0]?.pushers;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as { host?: unknown; id?: unknown }[];
    return Array.isArray(list) ? list.filter((p): p is { host: string; id: string } => typeof p?.host === 'string' && typeof p?.id === 'string') : [];
  } catch {
    return []; // stored by a checked setting: never malformed
  }
}

/** The home's own forge and host, for defaulting and for the cross-host rule. */
export function homeForgeOf(store: Store, repository: string): HomeForge | null {
  const r = store.exec<{ forge: Forge; web_base: string | null; github: string }>('SELECT forge, web_base, github FROM repositories WHERE id = ?', repository).toArray()[0];
  if (!r) return null;
  let host: string | null = null;
  if (r.web_base != null) {
    try {
      host = new URL(r.web_base).host.toLowerCase();
    } catch {
      host = null;
    }
  }
  return { forge: r.forge, host, github: r.github };
}

/** The entries on a host other than the home's (R-BTN-188's B-182 refusal): every entry of a
 *  `git` home — it has no host of its own — and, on a forge home, each whose host differs from
 *  the home's. */
export function crossHostEntries(store: Store, repository: string): CodeRepo[] {
  const home = homeForgeOf(store, repository);
  if (!home) return [];
  const homeHost = home.forge === 'git' ? null : home.host;
  return codeReposOf(store, repository).filter((e) => homeHost == null || e.host !== homeHost);
}

/** A repository's `web_base` host, or null — the small read the refusal messages share. */
export function hostOf(store: Store, repository: string): string | null {
  return homeForgeOf(store, repository)?.host ?? null;
}

/** One repository a ticket may link into, as the link rule judges it (R-BTN-92, R-BTN-140): its
 *  forge and its own `web_base`. */
export interface RepoBase {
  forge: Forge;
  webBase: string;
}

/** The repositories a ticket's links pass by (R-BTN-92's amended link rule): its home, when the
 *  home has a `web_base`, and each `repos:` name that resolves — full path, or a short name
 *  under the home's owner — to a `code_repos` entry, by that entry's own `web_base`. While the
 *  home lists no code repository, every forge-valid `repos:` name keeps today's reading: a base
 *  under the home's own host (a list that was never written narrows nothing). A `git` home
 *  contributes no base of its own. */
export function ticketRepositories(store: Store, repository: string, repos: string[]): RepoBase[] {
  const home = homeForgeOf(store, repository);
  if (!home) return [];
  const entries = codeReposOf(store, repository);
  const owner = home.github.slice(0, home.github.indexOf('/'));
  const full = (r: string) => (r.includes('/') ? r : `${owner}/${r}`);
  const out: RepoBase[] = [];
  const add = (base: RepoBase) => {
    if (!out.some((b) => b.webBase.toLowerCase() === base.webBase.toLowerCase())) out.push(base);
  };
  if (home.forge !== 'git' && home.host != null) add({ forge: home.forge, webBase: `https://${home.host}/${home.github}` });
  if (entries.length) {
    for (const r of repos) {
      const entry = entries.find((e) => e.path.toLowerCase() === full(r).toLowerCase());
      if (entry) add({ forge: entry.forge, webBase: entry.web_base });
    }
  } else {
    // Today's reading (R-BTN-92 as before B-182): every `repos:` name under the home's host.
    for (const r of repos) {
      const path = full(r);
      if (home.forge !== 'git' && home.host != null && isForgePath(home.forge, path)) add({ forge: home.forge, webBase: `https://${home.host}/${path}` });
    }
  }
  return out;
}
