import { DEFAULT_FORGE, FORGE_SHAPES, hasPrs, PR_FORGES, type Forge, type PrForge } from '../../core/forges';
import { isForgePath, isWebBase } from '../../core/links';
import { githubFactReader } from './github-facts';
import { immutableId, openRef, opened, prNumber, rest, sameRepository } from './rest';
import { readRestFacts, type RestFactShape } from './rest-facts';
import type { FactContext, ForgeClient, ForgeOptions, ForgeRegistration, ForgeRepo, OpenPr } from './types';

interface Adapter {
  publicHost: string;
  api: (origin: string) => string;
  prs: (path: string) => string;
  comments: (path: string, n: number) => string;
  openBody: (pr: OpenPr) => object;
  url: string;
  head: (raw: any) => ReturnType<typeof openRef>;
  openQuery: string;
  allQuery?: string;
  graphql?: (origin: string) => string;
  protectedRefusal: (detail: string) => boolean;
  restFacts?: RestFactShape;
  cli?: boolean;
  auth?: string;
  pageSizeKey?: string;
  /** The sync's attestations' reads (R-BTN-10, R-BTN-82), on the forges whose adapter reads them:
   *  whether a commit or a web URL's object exists, and where a ticket close's output witness is
   *  posted on its commit. A forge with none answers no evidence and posts no witness. */
  attest?: Attest;
}
interface Attest {
  /** The REST path answering whether `sha` is a commit of `path`. */
  commit: (path: string, sha: string) => string;
  /** A web URL's repository path and the REST path answering whether its object exists, or
   *  null for a URL form this adapter does not read. */
  evidence: (url: URL) => { repo: string; api: string } | null;
  /** The REST path a commit comment is posted to. */
  witness: (path: string, sha: string) => string;
}
/** GitHub's evidence forms (R-BTN-10): an issue or PR comment, a review, a review comment, a PR,
 *  an issue or a commit, each the REST object that answers 200 when it exists. */
function githubEvidence(url: URL): { repo: string; api: string } | null {
  const m = /^\/([^/]+)\/([^/]+)\/(pull|issues|commit)\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  const [, owner, name, kind, id] = m;
  const at = (api: string) => ({ repo: `${owner}/${name}`, api: `/repos/${owner}/${name}${api}` });
  const hash = url.hash.slice(1);
  if (kind === 'commit') return /^[0-9a-f]{7,40}$/.test(id) ? at(`/commits/${id}`) : null;
  if (!/^\d+$/.test(id)) return null;
  let f: RegExpExecArray | null;
  if ((f = /^issuecomment-(\d+)$/.exec(hash))) return at(`/issues/comments/${f[1]}`);
  if (kind === 'issues') return hash === '' ? at(`/issues/${id}`) : null;
  if ((f = /^pullrequestreview-(\d+)$/.exec(hash))) return at(`/pulls/${id}/reviews/${f[1]}`);
  if ((f = /^discussion_r(\d+)$/.exec(hash))) return at(`/pulls/comments/${f[1]}`);
  return hash === '' ? at(`/pulls/${id}`) : null;
}
const pulls = (path: string) => `/repos/${path}/pulls`;
const issues = (path: string, n: number) => `/repos/${path}/issues/${n}/comments`;
const pullHead = (p: any, branch = p?.head?.ref) => ({ ...openRef(p?.number, branch, p?.head?.sha), sameRepository: sameRepository(p?.head?.repo?.id, p?.base?.repo?.id) });
const pullBody = ({ title, head, base, body }: OpenPr) => ({ title, head, base, body });
const project = (path: string) => `/projects/${encodeURIComponent(path)}`;
const mergeRequests = (path: string) => `${project(path)}/merge_requests`;
const publicOrigin = FORGE_SHAPES[DEFAULT_FORGE].defaultOrigin;
const publicApi = FORGE_SHAPES[DEFAULT_FORGE].dispatchOrigin;

/** Runner-owned credentials and wire formats. Core never imports these clients. */
const ADAPTERS: Record<PrForge, Adapter> = {
  github: {
    publicHost: new URL(publicOrigin).host, api: (origin) => origin === publicOrigin ? publicApi : `${origin}/api/v3`,
    graphql: (origin) => origin === publicOrigin ? `${publicApi}/graphql` : `${origin}/api/graphql`,
    prs: pulls, comments: issues, openBody: pullBody, url: 'html_url', head: (p) => pullHead(p), openQuery: 'state=open', cli: true,
    attest: { commit: (path, sha) => `/repos/${path}/commits/${sha}`, evidence: githubEvidence, witness: (path, sha) => `/repos/${path}/commits/${sha}/comments` },
    protectedRefusal: (s) => /GH006/i.test(s) || (/GH013/i.test(s) && !/secret|push protection/i.test(s) && /pull request|update rule|required status check/i.test(s)),
  },
  gitlab: {
    publicHost: 'gitlab.com', api: (origin) => `${origin}/api/v4`, prs: mergeRequests,
    comments: (path, n) => `${mergeRequests(path)}/${n}/notes`,
    openBody: ({ title, head, base, body }) => ({ title, source_branch: head, target_branch: base, description: body }),
    url: 'web_url', head: (p) => ({ ...openRef(p?.iid, p?.source_branch, p?.sha), sameRepository: sameRepository(p?.source_project_id, p?.target_project_id) }), openQuery: 'state=opened',
    protectedRefusal: (s) => /not allowed to push code to protected branches/i.test(s),
    restFacts: {
      state: (p) => p.state === 'merged' ? 'merged' : p.state === 'opened' ? 'open' : p.state === 'closed' ? 'closed' : null,
      identity: (path) => project(path), ownerId: (p) => p.namespace?.id,
      commits: (path, n) => `${mergeRequests(path)}/${n}/commits`,
      commit: (c) => ({ oid: c.id, date: c.committed_date, message: c.message, parent: c.parent_ids?.[0] }),
      checks: (path, oid) => `${project(path)}/repository/commits/${oid}/statuses`,
      conclusion: (c) => status(c.status), user: (note) => note.system === true ? null : note.author,
      author: (u) => u.username, reviewDate: (n) => n.created_at,
      permission: (path, id) => `${project(path)}/members/all/${id}`,
      canPush: (p, id) => p?.id === id && Number.isSafeInteger(p.access_level) && p.access_level >= 30,
      scopeRefusal: (msg) => /insufficient_scope/i.test(msg),
      gitTrees: true,
    },
  },
  gitea: {
    publicHost: 'gitea.com', api: (origin) => `${origin}/api/v1`, prs: pulls, comments: issues,
    openBody: pullBody, url: 'html_url',
    // `label` is the source branch; `ref` may become the synthetic PR ref after deletion.
    head: (p) => ({ ...openRef(p?.number, p?.head?.label || p?.head?.ref, p?.head?.sha), sameRepository: sameRepository(p?.head?.repo_id, p?.base?.repo_id) }),
    openQuery: 'state=open', allQuery: 'state=all', auth: 'token', pageSizeKey: 'limit',
    protectedRefusal: (s) => /not allowed to push to protected branch/i.test(s),
    restFacts: {
      listQuery: 'state=all',
      state: (p) => p.merged === true || p.merged_at ? 'merged' : p.state === 'open' || p.state === 'closed' ? p.state : null,
      identity: (path) => `/repos/${path}`, ownerId: (p) => p.owner?.id,
      commits: (path, n) => `${pulls(path)}/${n}/commits`,
      commit: (c) => ({ oid: c.sha, date: c.commit?.committer?.date, message: c.commit?.message, parent: c.parents?.[0]?.sha, tree: c.commit?.tree?.sha }),
      newestCommitFirst: true,
      treeOf: (path, oid) => `/repos/${path}/git/commits/${oid}`,
      checks: (path, oid) => `/repos/${path}/commits/${oid}/status`,
      checkItems: (p) => p?.statuses ?? (p && (p.total_count === 0 || Object.keys(p).length === 0) ? [] : undefined),
      conclusion: (c) => status(c.status),
      user: (c) => c.user, author: (u) => u.login, reviewDate: (c) => c.submitted_at ?? c.created_at,
      reviews: (path, n) => `${pulls(path)}/${n}/reviews`,
      unpagedComments: true,
      permission: (path, _id, login) => `/repos/${path}/collaborators/${encodeURIComponent(login)}/permission`,
      canPush: (p, id) => p?.user?.id === id && ['write', 'admin', 'owner'].includes(p.permission),
      scopeRefusal: (msg) => /token.*scope|Only admins can query all permissions/i.test(msg),
    },
  },
};

function status(v: unknown): string | null {
  if (v === 'success' || v === 'skipped' || v === 'neutral') return v;
  if (v === 'failed' || v === 'failure' || v === 'error' || v === 'canceled' || v === 'cancelled') return 'failure';
  return null;
}

export const tokenOf = (forge: PrForge): string => `${forge.toUpperCase()}_TOKEN`;
export const forgeApi = (forge: PrForge, host: string): string => ADAPTERS[forge].api(`https://${host}`);
export const publicHost = (forge: PrForge): string => ADAPTERS[forge].publicHost;
export const protectedRefusal = (forge: PrForge, detail: string): boolean => ADAPTERS[forge].protectedRefusal(detail);
export const legacyProtectedRefusal = (detail: string): boolean => PR_FORGES.some((f) => protectedRefusal(f, detail));
export const inferForge = (host: string | null): PrForge | null => PR_FORGES.find((f) => publicHost(f) === host) ?? null;
/** R-BTN-82: whether a repository's forge adapter posts and reads back a ticket close's output
 *  witness (a comment on the close commit, by a pusher). */
export const witnessed = (repo: ForgeRepo | null): boolean => repo != null && ADAPTERS[repo.forge].attest != null;
/** The REST object a forge's adapter reads for an evidence URL, or null for a form it does not read. */
export const evidenceApiPath = (forge: PrForge, url: URL): { repo: string; api: string } | null => ADAPTERS[forge].attest?.evidence(url) ?? null;

export function prRepo(r: ForgeRegistration): ForgeRepo | null {
  if (!hasPrs(r.forge)) return null;
  if (!r.webBase || !isWebBase(r.forge, r.webBase, r.path)) throw new Error(`invalid registered web base for ${r.path}`);
  return { ...r, forge: r.forge, webBase: r.webBase };
}

export function registration(value: unknown): ForgeRegistration | undefined {
  const r = value as ForgeRegistration | null;
  if (r && typeof r.path === 'string' && Object.hasOwn(FORGE_SHAPES, r.forge)
      && isForgePath(r.forge as Forge, r.path) && (r.webBase === null || typeof r.webBase === 'string')) return r;
  return undefined;
}

export function forgeReader(facts: FactContext) {
  const github = githubFactReader(facts);
  const counts = new Map<string, number>();
  const permissions = new Map<string, Promise<boolean>>();
  const degraded = new Set<string>();
  return (repo: ForgeRepo, opts?: ForgeOptions) => forgeClient(repo, opts, {
    facts, github, permissions, degraded,
    spend() {
      const host = new URL(repo.webBase).host;
      const count = (counts.get(host) ?? 0) + 1;
      counts.set(host, count);
      if (count > 200) throw new Error(`${host}: exceeded its request budget`);
    },
  });
}

export function forgeClient(repo: ForgeRepo, opts: ForgeOptions = {}, reader?: {
  facts: FactContext; github: ReturnType<typeof githubFactReader>; spend: () => void;
  permissions: Map<string, Promise<boolean>>; degraded: Set<string>;
}): ForgeClient {
  const adapter = ADAPTERS[repo.forge];
  const env = opts.env ?? process.env;
  const given = (adapter.cli ? env.GH_TOKEN : undefined) || env[tokenOf(repo.forge)];
  const token = () => {
    if (!given) throw new Error(`no ${tokenOf(repo.forge)} to read or write ${repo.path}`);
    return given;
  };
  const origin = new URL(repo.webBase).origin;
  let requests = 0;
  const api = rest(adapter.api(origin), repo.forge, token, opts.fetchImpl ?? fetch, adapter.auth, () => {
    if (reader) reader.spend();
    else if (++requests > 200) throw new Error(`${repo.forge} exceeded its request budget for ${repo.path}`);
  });
  const path = repo.path;
  const pulls = adapter.prs(path);
  const all = (endpoint: string) => api.list(endpoint, adapter.pageSizeKey);
  const cli = adapter.cli && !given && opts.run && opts.checkout
    ? (args: string[]) => opts.run!('gh', args, opts.checkout!).trim() : null;
  const repoFlag = repo.webBase.startsWith(`${FORGE_SHAPES[DEFAULT_FORGE].defaultOrigin}/`) ? path : `${new URL(repo.webBase).host}/${path}`;
  return {
    async openPr(pr) {
      const url = cli
        ? cli(['pr', 'create', '--repo', repoFlag, '--head', pr.head, '--base', pr.base, '--title', pr.title, '--body', pr.body ?? '']).split('\n').at(-1)
        : (await api.request(pulls, adapter.openBody(pr)))?.[adapter.url];
      return opened(repo, url);
    },
    async listOpenPrs() {
      if (!cli) return (await all(`${pulls}?${adapter.openQuery}`)).map(adapter.head);
      return listCli(cli, repoFlag);
    },
    async listPrs() {
      if (cli) return listCli(cli, repoFlag, 'all');
      const query = adapter.allQuery ?? (adapter.cli ? 'state=all' : '');
      return (await all(`${pulls}${query ? `?${query}` : ''}`)).map((p) => ({ ...adapter.head(p), state: adapter.restFacts?.state(p) ?? (p.merged_at ? 'merged' : p.state) }));
    },
    async comment(number, body) {
      if (!prNumber(number)) throw new Error('invalid PR number');
      const prUrl = `${repo.webBase}${FORGE_SHAPES[repo.forge].pr}${number}`;
      if (cli) return commentUrl(prUrl, cli(['pr', 'comment', prUrl, '--body', body]));
      const response = await api.request(adapter.comments(path, number), { body });
      if (typeof response?.html_url === 'string') return commentUrl(prUrl, response.html_url);
      if (!immutableId(response?.id)) throw new Error(`${repo.forge} answered no comment id`);
      return `${prUrl}#${adapter.restFacts?.reviews ? 'issuecomment-' : 'note_'}${response.id}`;
    },
    async facts(read) {
      if (!reader) throw new Error('no fact context');
      if (!adapter.restFacts) return reader.github(repo, read, token(), { rest: adapter.api(origin), graphql: adapter.graphql!(origin) });
      const shape = adapter.restFacts;
      const canPush = (id: unknown, login: string): Promise<boolean> => {
        if (!immutableId(id)) return Promise.resolve(false);
        const key = `${repo.webBase.toLowerCase()}\0${id}`;
        if (!reader.permissions.has(key)) reader.permissions.set(key, (async () => {
          const res = await api.response(shape.permission(path, id, login));
          if (res.ok) return shape.canPush(await res.json(), id);
          if (res.status === 404) return false;
          if (res.status === 403 && !res.headers.has('retry-after') && res.headers.get('x-ratelimit-remaining') !== '0') {
            const msg = await res.text();
            if (shape.scopeRefusal(msg) || /insufficient_scope/i.test(res.headers.get('www-authenticate') ?? '')) {
              if (!reader.degraded.has(repo.webBase)) reader.facts.log(`baton.pushers-degraded: ${repo.path}: token cannot read push permissions; only listed pushers count`);
              reader.degraded.add(repo.webBase);
              return false;
            }
          }
          throw new Error(`${repo.path}: push permission read failed (${res.status})`);
        })());
        return reader.permissions.get(key)!;
      };
      return readRestFacts(repo, read, reader.facts, adapter, api, adapter.pageSizeKey, canPush);
    },
    async witness(sha, body) {
      const attest = adapter.attest;
      if (!attest || !SHA.test(sha)) return false;
      // The forge authenticates the commenter: the comment vouches for this commit alone.
      if (cli) cli(['api', '--hostname', new URL(repo.webBase).host, '-X', 'POST', attest.witness(path, sha).slice(1), '-f', `body=${body}`]);
      else await api.request(attest.witness(path, sha), { body });
      return true;
    },
    evidence(ref) {
      const attest = adapter.attest;
      if (!attest || !given) return null;
      let at: string;
      if (SHA.test(ref)) at = attest.commit(path, ref);
      else {
        let url: URL;
        try { url = new URL(ref); } catch { return null; }
        const read = url.protocol === 'https:' && url.origin === origin ? attest.evidence(url) : null;
        if (!read || read.repo.toLowerCase() !== path.toLowerCase()) return null;
        at = read.api;
      }
      return async () => {
        try {
          return (await api.response(at)).status;
        } catch {
          return null;
        }
      };
    },
    protectedRefusal: adapter.protectedRefusal,
  };
}

const SHA = /^[0-9a-f]{40}$/;

/** R-BTN-10: the forge reads the sync's `std:git.evidence@1` check makes, each through the adapter
 *  of the forge the evidence is on — a commit at the registered home's forge, a URL at the forge
 *  whose host it names (an adapter's public host, or a registered repository's). Null for
 *  evidence no adapter may be asked about (no credential, an unknown host, a form it does not
 *  read), so a credential is never sent anywhere but a known host's API. */
export function evidenceReader(home: ForgeRepo | null, known: readonly ForgeRepo[], opts: ForgeOptions = {}): (evidence: string) => (() => Promise<number | null>) | null {
  const hosts = new Map<string, PrForge>();
  for (const f of PR_FORGES) if (ADAPTERS[f].attest) hosts.set(ADAPTERS[f].publicHost, f);
  for (const r of [...(home ? [home] : []), ...known]) if (ADAPTERS[r.forge].attest) hosts.set(new URL(r.webBase).host, r.forge);
  const clients = new Map<string, ForgeClient>();
  const client = (r: ForgeRepo): ForgeClient => {
    const key = `${r.forge}\0${r.webBase.toLowerCase()}`;
    if (!clients.has(key)) clients.set(key, forgeClient(r, opts));
    return clients.get(key)!;
  };
  return (evidence) => {
    if (SHA.test(evidence)) return home ? client(home).evidence(evidence) : null;
    let url: URL;
    try { url = new URL(evidence); } catch { return null; }
    const forge = url.protocol === 'https:' ? hosts.get(url.host) : undefined;
    const at = forge ? ADAPTERS[forge].attest!.evidence(url) : null;
    if (!forge || !at || !isForgePath(forge, at.repo)) return null;
    return client({ forge, path: at.repo, webBase: `${url.origin}/${at.repo}` }).evidence(evidence);
  };
}

/** Compatibility for a detached test or older runner without repository coordinates. */
export function listCli(run: (args: string[]) => string, repository?: string, state = 'open') {
  const text = run(['pr', 'list', '--state', state, '--limit', '300', '--json', 'number,headRefName,headRefOid,isCrossRepository,state', ...(repository ? ['--repo', repository] : [])]);
  let items: unknown;
  try { items = JSON.parse(text); } catch { /* diagnosed below */ }
  if (!Array.isArray(items) || items.length > 300) throw new Error(`gh pr list answered no PR list: ${text.slice(0, 200)}`);
  return items.map((p) => ({ ...openRef(p?.number, p?.headRefName, p?.headRefOid), sameRepository: p?.isCrossRepository === false, state: p?.state?.toLowerCase() }));
}

function commentUrl(prUrl: string, url: string): string {
  if (url.length > 1000 || url.split('#')[0] !== prUrl || !/^#[A-Za-z0-9_-]+$/.test(new URL(url).hash)) throw new Error('forge answered no comment URL on the requested PR');
  return url;
}
