// registry.ts — the registered repositories (BATON_SPEC §2a R-BTN-47, R-BTN-15, R-BTN-66).
// Only the instance administrator registers or retires one (R-BTN-57; `POST /v1/admin/
// repositories`, src/core/admin.ts). The deployment may also seed them from BATON_REPOSITORIES
// through the same validated `register`, insert-only: a seed never changes a repository Baton
// already knows. The sync principal is bound to one repository here.
import { BatonError } from './http';
import { parseSshKey } from './auth';
import type { Config, Store } from './ports';
import { REPOSITORY_ID, TIER_NAME } from './validate';
import { FORGES, isForgePath, isWebBase, parseTranscriptRepo, type Forge } from './links';

export { REPOSITORY_ID, TICKET_ID, qualify, repositoryOf, localOf } from './validate';

/** A default branch, registered by the administrator: stricter than any branch a push may name
 *  (GIT_BRANCH), as it goes unencoded into the dashboard's GitHub links. */
const BRANCH = /^(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/;
const WORKFLOW = /^\.github\/workflows\/[A-Za-z0-9._-]{1,100}\.ya?ml$/;
const TIER = TIER_NAME;
const DEFAULT_TIERS = ['routine', 'judgement', 'critical'];

/** How a repository's sync proves itself besides a sync key (R-BTN-93): GitHub Actions OIDC from its
 *  sync and mirror workflows, or a GitLab CI `id_tokens` JWT from its issuer. */
export type CiIdentity = { kind: 'github-actions' } | { kind: 'gitlab-ci'; issuer: string; mirror: boolean };

export interface Repository {
  id: string;
  /** The forge path (R-BTN-92), stored under its old name. */
  github: string;
  forge: Forge;
  remote: string;
  web_base: string | null;
  ci_identity: CiIdentity | null;
  default_branch: string;
  sync_workflow: string;
  mirror_workflow: string | null;
  weight: number;
  transcript_repos: string[];
  tiers: string[];
  cutover_at: number | null;
  retired_at: number | null;
}

/** A registration as `POST /v1/admin/repositories` takes it (§11), less the owner keys
 *  (`registration` in admin.ts), checked before anything is written (§10.4). */
export interface Registration {
  id: string;
  github: string;
  forge: Forge;
  remote: string;
  web_base: string | null;
  ci_identity: CiIdentity | null;
  sync_keys: { public_key: string; role: 'sync' | 'mirror' }[];
  default_branch: string;
  /** '' for none (R-BTN-93: only with a github-actions identity). */
  sync_workflow: string;
  mirror_workflow: string | null;
  weight: number;
  tiers: string[];
  transcript_repos: string[];
  cut_over: boolean;
}

/** A registered repository's fields — every field a registration has but the owner keys, which
 *  live in `repository_owners` (R-BTN-58), above a registration's own (B-91). */
const REGISTRATION_FIELDS = ['github', 'forge', 'remote', 'web_base', 'ci_identity', 'sync_keys', 'default_branch', 'sync_workflow', 'mirror_workflow', 'weight', 'tiers', 'transcript_repos', 'cut_over'] as const;

/** The seed's `owner_keys` (B-91): one to 16 OpenSSH public key lines (`<type> <base64>`), distinct. */
function checkOwnerKeys(v: unknown, at: string): string[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 16 || !v.every((k) => typeof k === 'string' && /^(ssh-ed25519|ecdsa-sha2-nistp256|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com) [A-Za-z0-9+/]+={0,2}( [^{}]*)?$/.test(k))) {
    bad(`${at}.owner_keys`, 'must be a list of 1–16 OpenSSH public key lines (`<type> <base64>`)');
  }
  if (new Set(v as string[]).size !== (v as string[]).length) bad(`${at}.owner_keys`, 'names a key twice');
  return v as string[];
}

/** The seed's `owner_keys` of one entry (B-91): theirs, or none. Throws on a malformed list. */
export function seedOwnerKeysOf(entry: unknown, at: string): string[] {
  const v = (entry as Record<string, unknown>).owner_keys;
  return v === undefined ? [] : checkOwnerKeys(v, at);
}

const bad = (field: string, why: string): never => {
  throw new BatonError('invalid-params', `${field}: ${why}`);
};

export function checkRegistration(v: unknown, at = 'repository'): Registration {
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad(at, 'must be an object');
  const r = v as Record<string, unknown>;
  const known = new Set(['id', ...REGISTRATION_FIELDS, 'owner_keys']);
  for (const k of Object.keys(r)) if (!known.has(k)) bad(`${at}.${k}`, 'unknown field');
  const str = (k: string, re: RegExp) => (typeof r[k] === 'string' && re.test(r[k] as string) ? (r[k] as string) : bad(`${at}.${k}`, `must match ${re}`));
  const tiers = r.tiers === undefined ? DEFAULT_TIERS
    : Array.isArray(r.tiers) && r.tiers.length >= 1 && r.tiers.length <= 16 && r.tiers.every((t) => typeof t === 'string' && TIER.test(t)) && new Set(r.tiers).size === r.tiers.length
      ? (r.tiers as string[]) : bad(`${at}.tiers`, 'must be 1–16 distinct tier names, lowest first');
  const transcript = r.transcript_repos === undefined ? []
    : Array.isArray(r.transcript_repos) && r.transcript_repos.length <= 20 && r.transcript_repos.every((x) => typeof x === 'string' && parseTranscriptRepo(x) !== null)
      ? (r.transcript_repos as string[]) : bad(`${at}.transcript_repos`, 'must be at most 20 repositories, each a GitHub owner/name or <forge>:<web_base>');
  const weight = r.weight === undefined ? 100
    : Number.isInteger(r.weight) && (r.weight as number) >= 0 && (r.weight as number) <= 10_000 ? (r.weight as number) : bad(`${at}.weight`, 'must be an integer from 0 to 10000');
  if (r.cut_over !== undefined && typeof r.cut_over !== 'boolean') bad(`${at}.cut_over`, 'must be true or false');
  // R-BTN-92: the forge, its path's grammar, the remote, the page every link is built from.
  const forge = (r.forge ?? 'github') as Forge;
  if (!(FORGES as readonly string[]).includes(forge)) bad(`${at}.forge`, `must be one of ${FORGES.join(', ')}`);
  const github = typeof r.github === 'string' && isForgePath(forge, r.github) ? r.github : bad(`${at}.github`, `must be a ${forge} forge path (owner/name${forge === 'gitlab' ? ', up to four segments' : ''})`);
  const webBase = r.web_base !== undefined ? r.web_base : forge === 'github' ? `https://github.com/${github}` : undefined;
  if (forge === 'git' ? webBase != null : typeof webBase !== 'string' || !isWebBase(forge, webBase, github)) {
    bad(`${at}.web_base`, forge === 'git' ? 'a git repository has none' : 'must be https://<host>[:<port>]/<forge path>, with no userinfo, query or fragment');
  }
  const remote = r.remote !== undefined ? r.remote : forge === 'github' ? `https://github.com/${github}.git` : undefined;
  // No credential ever reaches SQLite (R-BTN-94): an https remote has no userinfo, an ssh one a user
  // name at most (round 1, 1-A-5, 1-B-2).
  if (typeof remote !== 'string' || remote.length > 500
    || !/^(https:\/\/[A-Za-z0-9.-]+(:\d+)?\/|ssh:\/\/([A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+(:\d+)?\/|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)[^\s\\@?#\u0000-\u001f\u007f]+$/.test(remote)) {
    bad(`${at}.remote`, 'must be an https:// URL with no userinfo, an ssh:// URL, or user@host:path — never a credential');
  }
  const syncWorkflow = r.sync_workflow == null ? '' : str('sync_workflow', WORKFLOW);
  // GitHub Actions workflows and the App serve github.com alone (R-BTN-92): another forge, or a
  // GitHub Enterprise host, has none (round 1, 1-A-0, 1-A-6, 1-B-0).
  const onGithubCom = forge === 'github' && typeof webBase === 'string' && webBase.toLowerCase() === `https://github.com/${github.toLowerCase()}`;
  if ((syncWorkflow || r.mirror_workflow != null) && !onGithubCom) bad(`${at}.sync_workflow`, 'workflows are GitHub Actions on github.com only');
  // A mirror workflow posts with the Actions identity; a repository of sync keys has its mirror key
  // instead (round 2, 2-A-0).
  if (r.mirror_workflow != null && !syncWorkflow) bad(`${at}.mirror_workflow`, 'needs the github-actions identity (a sync_workflow); a repository of sync keys uses a mirror key');
  const ci = checkCiIdentity(r.ci_identity, forge, syncWorkflow, `${at}.ci_identity`);
  // A GitLab token's issuer is the repository's own instance (round 1, 1-A-3).
  if (ci?.kind === 'gitlab-ci' && typeof webBase === 'string' && new URL(ci.issuer).origin !== new URL(webBase).origin) bad(`${at}.ci_identity.issuer`, "must be the web_base's GitLab instance");
  // B-91: the seed's owner keys (R-BTN-58), beside the registration's own fields; the
  // administrator's route takes them as `owner_keys` and never through here (admin.ts).
  if (r.owner_keys !== undefined) checkOwnerKeys(r.owner_keys, at);
  const keys = r.sync_keys === undefined ? []
    : Array.isArray(r.sync_keys) && r.sync_keys.length <= 4 && r.sync_keys.every((k) => k && typeof k === 'object' && typeof (k as Record<string, unknown>).public_key === 'string' && ['sync', 'mirror'].includes((k as Record<string, unknown>).role as string))
      ? (r.sync_keys as Registration['sync_keys']) : bad(`${at}.sync_keys`, 'must be at most 4 {public_key, role: sync|mirror}');
  if (!ci && !keys.some((k) => k.role === 'sync')) bad(at, 'a repository needs a CI identity or a sync key for its sync (R-BTN-93)');
  return {
    id: str('id', REPOSITORY_ID),
    github,
    forge,
    remote: remote as string,
    web_base: (webBase ?? null) as string | null,
    ci_identity: ci,
    sync_keys: keys,
    default_branch: str('default_branch', BRANCH),
    sync_workflow: syncWorkflow,
    mirror_workflow: r.mirror_workflow == null ? null : str('mirror_workflow', WORKFLOW),
    weight,
    tiers,
    transcript_repos: transcript,
    cut_over: r.cut_over === true,
  };
}

/** R-BTN-93: a repository's CI identity. Absent, a GitHub repository with a sync workflow is
 *  `github-actions` (the shape every registration had before R3-1262); a GitLab one names its
 *  issuer; `null` means sync keys only. */
function checkCiIdentity(v: unknown, forge: Forge, syncWorkflow: string, at: string): CiIdentity | null {
  if (v === undefined) return forge === 'github' && syncWorkflow ? { kind: 'github-actions' } : null;
  if (v === null) {
    if (syncWorkflow) bad(at, 'a sync_workflow needs the github-actions identity');
    return null;
  }
  const o = v as Record<string, unknown>;
  if (o && o.kind === 'github-actions' && Object.keys(o).length === 1) {
    if (forge !== 'github' || !syncWorkflow) bad(at, 'github-actions needs a github repository and its sync_workflow');
    return { kind: 'github-actions' };
  }
  if (o && o.kind === 'gitlab-ci' && typeof o.issuer === 'string' && (o.mirror === undefined || typeof o.mirror === 'boolean') && Object.keys(o).every((k) => ['kind', 'issuer', 'mirror'].includes(k))) {
    if (forge !== 'gitlab') bad(at, 'gitlab-ci needs a gitlab repository');
    if (syncWorkflow) bad(at, 'sync_workflow is the github-actions identity\'s');
    let u: URL | null = null;
    try {
      u = new URL(o.issuer);
    } catch {
      u = null;
    }
    if (!u || u.protocol !== 'https:' || u.username || u.search || u.hash || u.pathname !== '/' || o.issuer.endsWith('/')) bad(`${at}.issuer`, 'must be https://<gitlab host>');
    return { kind: 'gitlab-ci', issuer: o.issuer, mirror: o.mirror === true };
  }
  return bad(at, "must be {kind: 'github-actions'} or {kind: 'gitlab-ci', issuer, mirror?}");
}

/** §6.8: the transcript repositories, for a repository that has named none yet. */
export const DEFAULT_TRANSCRIPT_REPOS = ['immediately-run/claude-sessions', 'immediately-run-worker/session-transcripts'];

/** §6.8: one repository's transcript repositories, or the defaults while it names none. */
export function transcriptReposOf(store: Store, repo: string): string[] {
  const raw = store.exec<{ transcript_repos: string }>('SELECT transcript_repos FROM repositories WHERE id = ?', repo).toArray()[0]?.transcript_repos;
  const list = raw ? (JSON.parse(raw) as string[]) : [];
  return list.length ? list : DEFAULT_TRANSCRIPT_REPOS;
}

/** A worker's ceiling in one repository's ladder (§7.2 rule 5, R-BTN-66): the one it declared
 *  for that repository; else its single `tier_ceiling` where the ladder has that name; else the
 *  ladder's top if that ceiling is the unrestricted default (`critical`, docs' top), and the
 *  ladder's bottom otherwise — a restricted worker is never widened by a ladder it did not name.
 *  A grant's `max_tier` caps it further (R-BTN-58, Claims.ceiling). */
export function ceilingIn(repo: string, ladder: string[], ceilings: Record<string, string>, legacy: string): string {
  const named = ceilings[repo];
  if (named !== undefined) return ladder.includes(named) ? named : ladder[0]; // a ceiling it named, never widened
  if (ladder.includes(legacy)) return legacy;
  return legacy === 'critical' ? ladder[ladder.length - 1] : ladder[0];
}

/** A ticket tier's position in its repository's ladder: null untiered (fits only the top); a name
 *  the ladder lacks is the ladder's length, which fits nothing. */
export const tierPosition = (ladder: string[], tier: string | null) =>
  tier == null ? null : ladder.includes(tier) ? ladder.indexOf(tier) : ladder.length;

/** The claims of a verified GitHub Actions OIDC token that bind it (R-BTN-15). */
export interface SyncClaims {
  repository: string;
  ref: string;
  job_workflow_ref: string;
}

type RepoRow = Omit<Repository, 'transcript_repos' | 'tiers' | 'ci_identity'> & { transcript_repos: string; tiers: string; ci_identity: string | null };
const parse = (r: RepoRow): Repository => ({ ...r, transcript_repos: JSON.parse(r.transcript_repos), tiers: JSON.parse(r.tiers), ci_identity: r.ci_identity ? JSON.parse(r.ci_identity) : null });
const REPO_COLUMNS = 'id, github, forge, remote, web_base, ci_identity, default_branch, sync_workflow, mirror_workflow, weight, transcript_repos, tiers, cutover_at, retired_at';

export class Registry {
  constructor(private readonly c: { store: Store; now: () => number }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }

  /** Register a repository, insert-only: an id or GitHub repository already known is refused
   *  `invalid-params` (retiring and changing one are the administrator's, R3-1240). */
  register(input: unknown, opts: { keysAddedLater?: boolean } = {}): Repository {
    const r = checkRegistration(input);
    // Keys are added by registerWithKeys or the seed's seedSyncKeys (their fingerprints need
    // WebCrypto, an await); never dropped in silence (round 1, 1-A-7).
    if (r.sync_keys.length && !opts.keysAddedLater) bad('sync_keys', 'are added with registerWithKeys');
    if (this.rows('SELECT 1 FROM repositories WHERE id = ? OR github = ? COLLATE NOCASE', r.id, r.github).length) {
      bad('repository', `${r.id} (${r.github}) is already registered`);
    }
    this.c.store.exec(
      `INSERT INTO repositories (id, github, forge, remote, web_base, ci_identity, dispatch, default_branch, sync_workflow, mirror_workflow, weight, transcript_repos, tiers, cutover_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id, r.github, r.forge, r.remote, r.web_base, r.ci_identity ? JSON.stringify(r.ci_identity) : null,
      // The App serves github.com alone (round 2, 2-A-4).
      r.forge === 'github' && r.web_base?.toLowerCase() === `https://github.com/${r.github.toLowerCase()}` ? '{"kind":"github-app"}' : null,
      r.default_branch, r.sync_workflow, r.mirror_workflow, r.weight, JSON.stringify(r.transcript_repos), JSON.stringify(r.tiers),
      r.cut_over ? this.c.now() : null);
    this.c.store.exec('INSERT INTO board_head (repository_id, sha) VALUES (?, NULL) ON CONFLICT (repository_id) DO NOTHING', r.id);
    return this.get(r.id)!;
  }

  /** BATON_REPOSITORIES at start: each entry not yet known is registered; a known one is left
   *  as it is. A malformed value throws, so a broken deploy is seen at once. B-91: an entry's
   *  `owner_keys` (R-BTN-58) are its repository's first owners, written by `seedOwnerKeys` once
   *  their fingerprints are known. */
  seed(config: Config): string[] {
    const raw = config.BATON_REPOSITORIES;
    if (!raw) return [];
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch {
      throw new Error('BATON_REPOSITORIES is not JSON');
    }
    if (!Array.isArray(list)) throw new Error('BATON_REPOSITORIES must be a JSON array');
    const added: string[] = [];
    // Every entry is checked before anything is written (B-91): a malformed second entry leaves
    // no half-seeded instance behind the first.
    const entries = list.map((entry, i) => ({ entry, r: checkRegistration(entry, `BATON_REPOSITORIES[${i}]`) }));
    for (const { entry, r } of entries) {
      if (this.rows('SELECT 1 FROM repositories WHERE id = ?', r.id).length) continue;
      this.register(entry, { keysAddedLater: true });
      added.push(r.id);
    }
    return added;
  }

  /** BATON_REPOSITORIES' `owner_keys` at start (B-91; R-BTN-58): each entry's keys are its
   *  repository's owners, `added_by: 'admin:seed'`, written only where that repository has no
   *  owner left — so a re-seed after an owner leaves brings the seed's back, and a registration
   *  that already has one keeps it (every key of the entry, or none). One key an administrator
   *  revoked, or one that holds another role (R-BTN-57), throws as a malformed seed does: the
   *  deploy is stopped where a person can see it, never serving on with a key the route itself
   *  would refuse. Every key of every entry is parsed and checked before the first write, and the
   *  writes run in one transaction, so a bad entry leaves no half-seeded instance. */
  async seedOwnerKeys(config: Config, admins: Map<string, string>): Promise<void> {
    if (!config.BATON_REPOSITORIES) return;
    const writes: { id: string; key: { type: string; fingerprint: string }; line: string }[] = [];
    for (const [i, entry] of (JSON.parse(config.BATON_REPOSITORIES) as unknown[]).entries()) {
      const at = `BATON_REPOSITORIES[${i}]`;
      const r = checkRegistration(entry, at);
      const lines = seedOwnerKeysOf(entry, at);
      if (!lines.length) continue;
      if (this.rows('SELECT 1 FROM repository_owners WHERE repository_id = ? AND removed_at IS NULL', r.id).length) continue;
      if (this.rows('SELECT 1 FROM repositories WHERE id = ? AND retired_at IS NOT NULL', r.id).length) continue;
      for (const line of lines) {
        // A line of the right shape whose base64 is no key at all: the seed stops, as on any
        // malformed entry (1-A-7: never dropped in silence).
        const key = await parseSshKey(line).catch(() => bad(`${at}.owner_keys`, `is not an OpenSSH public key: ${line.slice(0, 40)}`));
        // `admin repo add` refuses an administrator's key as an owner with `conflict`; so does the
        // seed, so a deploy that would refuse at the route stops at its start instead.
        if (admins.has(key.fingerprint)) throw new BatonError('conflict', `${at}.owner_keys names an administrator key (R-BTN-57: one role per key)`);
        if (this.rows('SELECT 1 FROM repository_owners WHERE fingerprint = ? AND revoked_at IS NOT NULL', key.fingerprint).length) {
          throw new BatonError('conflict', `${at}.owner_keys: this owner key was revoked; its holder needs a new key`);
        }
        if (this.rows('SELECT 1 FROM sync_keys WHERE fingerprint = ?', key.fingerprint).length) {
          throw new BatonError('conflict', `${at}.owner_keys: a key is named both as an owner key and as a sync key (R-BTN-57)`);
        }
        if (this.rows('SELECT 1 FROM credentials WHERE id = ?', key.fingerprint).length) {
          throw new BatonError('conflict', `${at}.owner_keys: this key is already a worker, probe or courier key (R-BTN-57: one role per key)`);
        }
        writes.push({ id: r.id, key, line });
      }
    }
    // One transaction over every entry's keys: no write before the last check passes.
    this.c.store.transaction(() => {
      for (const { id, key, line } of writes) {
        this.c.store.exec(`INSERT INTO repository_owners (repository_id, public_key, fingerprint, added_by, added_at) VALUES (?, ?, ?, 'admin:seed', ?)
                           ON CONFLICT (repository_id, public_key) DO UPDATE SET removed_at = NULL, added_by = excluded.added_by, added_at = excluded.added_at`,
          id, `${key.type} ${line.trim().split(/\s+/)[1]}`, key.fingerprint, this.c.now());
      }
    });
  }

  /** The owner keys of `repositories` whose `added_by` is `addedBy` (B-91): the seed's own, for
   *  the read that says which registrations still lean on a deploy (`Admin.view`). */
  ownerKeysAddedBy(repositories: string[], addedBy: string): { repository_id: string; public_key: string }[] {
    if (!repositories.length) return [];
    return this.rows<{ repository_id: string; public_key: string }>(
      `SELECT repository_id, public_key FROM repository_owners WHERE removed_at IS NULL AND added_by = ? AND repository_id IN (${repositories.map(() => '?').join(', ')})`,
      addedBy, ...repositories);
  }

  /** R-BTN-93: a sync key for `repository` in `role`. A key serves one repository and holds one
   *  role (R-BTN-57): one that is already a sync key, a worker, probe or courier credential, or an
   *  administrator's key is refused `conflict`. `adminKeys` are BATON_ADMIN_KEYS' lines. */
  async addSyncKey(repository: string, publicKey: string, role: 'sync' | 'mirror', addedBy: string, adminKeys: string[]): Promise<string> {
    const key = await this.prepareSyncKey(publicKey, adminKeys);
    this.c.store.transaction(() => this.insertSyncKey(repository, key, role, addedBy));
    return key.fingerprint;
  }

  /** The awaited half of adding a sync key: its fingerprint, its stored line, and the
   *  administrators' check (WebCrypto). */
  private async prepareSyncKey(publicKey: string, adminKeys: string[]): Promise<{ fingerprint: string; line: string }> {
    const key = await parseSshKey(publicKey);
    const admins = await Promise.all(adminKeys.map((k) => parseSshKey(k).then((p) => p.fingerprint, () => null)));
    if (admins.includes(key.fingerprint)) throw new BatonError('conflict', 'an administrator key holds no other role (R-BTN-57)');
    return { fingerprint: key.fingerprint, line: `${key.type} ${publicKey.trim().split(/\s+/)[1]}` };
  }

  /** The synchronous half: the one-role checks and the insert, in the caller's transaction. */
  private insertSyncKey(repository: string, key: { fingerprint: string; line: string }, role: 'sync' | 'mirror', addedBy: string): void {
    {
      if (!this.rows('SELECT 1 FROM repositories WHERE id = ? AND retired_at IS NULL', repository).length) bad('repository', `${repository} is not registered`);
      if (this.rows('SELECT 1 FROM credentials WHERE id = ? OR public_key = ?', key.fingerprint, key.line).length) {
        throw new BatonError('conflict', 'this key is already a worker, probe or courier key (R-BTN-57: one role per key)');
      }
      if (this.rows('SELECT 1 FROM repository_owners WHERE fingerprint = ? AND removed_at IS NULL', key.fingerprint).length) {
        throw new BatonError('conflict', 'this key is an owner key (R-BTN-57: one role per key)');
      }
      if (this.rows('SELECT 1 FROM sync_keys WHERE fingerprint = ?', key.fingerprint).length) {
        throw new BatonError('conflict', 'this key is already a sync key: a sync key serves one repository in one role (R-BTN-93)');
      }
      this.c.store.exec('INSERT INTO sync_keys (fingerprint, repository_id, role, public_key, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)',
        key.fingerprint, repository, role, key.line, addedBy, this.c.now());
    }
  }

  /** Register a repository and add its `sync_keys` (R-BTN-93), for `POST /v1/admin/repositories`. */
  async registerWithKeys(input: unknown, addedBy: string, adminKeys: string[]): Promise<Repository> {
    const r = checkRegistration(input);
    // Every key is read first; then the repository and its keys go in one transaction, so a key
    // that conflicts leaves nothing behind (round 2, 2-A-3).
    const keys = await Promise.all(r.sync_keys.map(async (k) => ({ ...(await this.prepareSyncKey(k.public_key, adminKeys)), role: k.role })));
    return this.c.store.transaction(() => {
      const repo = this.register(input, { keysAddedLater: true });
      for (const k of keys) this.insertSyncKey(r.id, k, k.role, addedBy);
      return repo;
    });
  }

  /** BATON_REPOSITORIES' `sync_keys` at start, beside the administrator's routes: each key not yet known is
   *  added for its repository; one already serving that repository in that role is left; any other
   *  conflict throws, as a malformed seed does. */
  async seedSyncKeys(config: Config, adminKeys: string[]): Promise<void> {
    if (!config.BATON_REPOSITORIES) return;
    for (const [i, entry] of (JSON.parse(config.BATON_REPOSITORIES) as unknown[]).entries()) {
      const r = checkRegistration(entry, `BATON_REPOSITORIES[${i}]`);
      for (const k of r.sync_keys) {
        const fp = (await parseSshKey(k.public_key)).fingerprint;
        const known = this.rows<{ repository_id: string; role: string }>('SELECT repository_id, role FROM sync_keys WHERE fingerprint = ?', fp)[0];
        if (known && known.repository_id === r.id && known.role === k.role) continue;
        await this.addSyncKey(r.id, k.public_key, k.role, 'admin:seed', adminKeys);
      }
    }
  }

  /** The repository and role a sync key serves, or null for a key that is no sync key; a revoked
   *  one is null too (R-BTN-93). */
  syncKey(fingerprint: string): { repository: string; role: 'sync' | 'mirror'; public_key: string } | null {
    const k = this.rows<{ repository_id: string; role: 'sync' | 'mirror'; public_key: string }>(
      `SELECT k.repository_id, k.role, k.public_key FROM sync_keys k JOIN repositories r ON r.id = k.repository_id
       WHERE k.fingerprint = ? AND k.revoked_at IS NULL AND r.retired_at IS NULL`, fingerprint)[0];
    return k ? { repository: k.repository_id, role: k.role, public_key: k.public_key } : null;
  }

  get(id: string): Repository | null {
    const r = this.rows<RepoRow>(`SELECT ${REPO_COLUMNS} FROM repositories WHERE id = ?`, id)[0];
    return r ? parse(r) : null;
  }

  /** The repository whose sync still posts the instance's fleet data — providers, prices, the
   *  reviewer matrix and catalog — until the course data of §7.1's board post replaces them (§2a drops the reference repository; R3-1231). An interim, so it is
   *  the one a deployment registered first (docs, the board these tables came from), and no
   *  other repository's sync can rewrite what every repository's claims read. */
  fleetRepository(): string | null {
    return this.rows<{ id: string }>('SELECT id FROM repositories WHERE retired_at IS NULL ORDER BY rowid LIMIT 1')[0]?.id ?? null;
  }

  /** §6.8: the repositories a transcript pointer under one of `repo`'s claims may name — its
   *  own `transcript_repos` (R-BTN-66), or the defaults while it names none. */
  transcriptReposOf(repo: string): string[] {
    return transcriptReposOf(this.c.store, repo);
  }

  /** Every repository not retired, by id. */
  all(): Repository[] {
    return this.rows<RepoRow>(`SELECT ${REPO_COLUMNS} FROM repositories WHERE retired_at IS NULL ORDER BY id`).map(parse);
  }

  /** The one repository a verified GitLab CI token may act for (R-BTN-93): a `gitlab` repository
   *  whose `ci_identity` names the token's issuer and whose forge path is its `project_path`, on
   *  its default branch as a branch (`ref_type`, so a tag of that name is not it), in the role its
   *  audience names — `mirror` only where the identity says the repository has a GitLab mirror. */
  forGitlab(c: { issuer: string; project_path: string; ref: string; ref_type: string; role: 'sync' | 'mirror' }, role: 'sync' | 'mirror'): Repository {
    const row = this.rows<RepoRow>(
      `SELECT ${REPO_COLUMNS} FROM repositories WHERE github = ? COLLATE NOCASE AND forge = 'gitlab' AND retired_at IS NULL`, c.project_path)[0];
    const ci = row?.ci_identity ? (JSON.parse(row.ci_identity) as CiIdentity) : null;
    if (!row || ci?.kind !== 'gitlab-ci' || ci.issuer !== c.issuer) throw new BatonError('forbidden', 'the GitLab token is from a project this Baton does not serve');
    if (c.ref_type !== 'branch' || c.ref !== row.default_branch) throw new BatonError('forbidden', `the GitLab token is not from ${row.github}'s default branch`);
    if (c.role !== role || (role === 'mirror' && !ci.mirror)) throw new BatonError('forbidden', `the GitLab token's audience is not this route's role (${role})`);
    return parse(row);
  }

  /** The one repository a verified sync token may act for (R-BTN-15): its `repository` names a
   *  registered, unretired repository, `ref` is that repository's default branch, and
   *  `job_workflow_ref` is its sync workflow (role `sync`) or its mirror workflow (`mirror`)
   *  on that branch. Anything else is `forbidden`. */
  forSync(claims: SyncClaims, role: 'sync' | 'mirror'): Repository {
    const row = this.rows<RepoRow>(
      `SELECT ${REPO_COLUMNS} FROM repositories WHERE github = ? COLLATE NOCASE AND forge = 'github'
       AND lower(web_base) = 'https://github.com/' || lower(github) AND retired_at IS NULL`, claims.repository)[0];
    if (!row) throw new BatonError('forbidden', 'the OIDC token is from a repository this Baton does not serve');
    const branch = `refs/heads/${row.default_branch}`;
    const workflow = role === 'sync' ? row.sync_workflow : row.mirror_workflow;
    // GitHub spells the repository its own way; it matched case-insensitively above.
    if (!workflow || JSON.parse(row.ci_identity ?? 'null')?.kind !== 'github-actions' || claims.ref !== branch || claims.job_workflow_ref !== `${claims.repository}/${workflow}@${branch}`) {
      throw new BatonError('forbidden', `the OIDC token is not from this route’s workflow on ${row.github} ${row.default_branch}`);
    }
    return parse(row);
  }
}

