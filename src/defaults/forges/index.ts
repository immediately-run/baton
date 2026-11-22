import { DEFAULT_FORGE, FORGE_SHAPES, hasPrs, PR_FORGES, type Forge, type PrForge } from '../../core/forges';
import { isForgePath, isWebBase } from '../../core/links';
import { githubFactReader } from './github-facts';
import { openRef, opened, prNumber, rest } from './rest';
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
  protectedRefusal: (detail: string) => boolean;
  restFacts?: RestFactShape;
  cli?: boolean;
  auth?: string;
  pageSizeKey?: string;
}
const pulls = (path: string) => `/repos/${path}/pulls`;
const issues = (path: string, n: number) => `/repos/${path}/issues/${n}/comments`;
const pullHead: Adapter['head'] = (p) => openRef(p?.number, p?.head?.ref, p?.head?.sha);
const pullBody = ({ title, head, base, body }: OpenPr) => ({ title, head, base, body });
const project = (path: string) => `/projects/${encodeURIComponent(path)}`;
const mergeRequests = (path: string) => `${project(path)}/merge_requests`;

/** Runner-owned credentials and wire formats. Core never imports these clients. */
const ADAPTERS: Record<PrForge, Adapter> = {
  github: {
    publicHost: 'github.com', api: (origin) => origin === 'https://github.com' ? 'https://api.github.com' : `${origin}/api/v3`,
    prs: pulls, comments: issues, openBody: pullBody, url: 'html_url', head: pullHead, openQuery: 'state=open', cli: true,
    protectedRefusal: (s) => /GH006/i.test(s) || (/GH013/i.test(s) && !/secret|push protection/i.test(s) && /pull request|update rule|required status check/i.test(s)),
  },
  gitlab: {
    publicHost: 'gitlab.com', api: (origin) => `${origin}/api/v4`, prs: mergeRequests,
    comments: (path, n) => `${mergeRequests(path)}/${n}/notes`,
    openBody: ({ title, head, base, body }) => ({ title, source_branch: head, target_branch: base, description: body }),
    url: 'web_url', head: (p) => openRef(p?.iid, p?.source_branch, p?.sha), openQuery: 'state=opened',
    protectedRefusal: (s) => /not allowed to push code to protected branches/i.test(s),
    restFacts: {
      state: (p) => p.state === 'merged' ? 'merged' : p.state === 'opened' ? 'open' : p.state === 'closed' ? 'closed' : null,
      identity: (path) => project(path), ownerId: (p) => p.namespace?.id,
      commits: (path, n) => `${mergeRequests(path)}/${n}/commits`,
      commit: (c) => ({ oid: c.id, date: c.committed_date, message: c.message, parent: c.parent_ids?.[0] }),
      checks: (path, oid) => `${project(path)}/repository/commits/${oid}/statuses`,
      conclusion: (c) => status(c.status), user: (note) => note.system === true ? null : note.author,
      author: (u) => u.username, reviewDate: (n) => n.created_at,
    },
  },
  gitea: {
    publicHost: 'gitea.com', api: (origin) => `${origin}/api/v1`, prs: pulls, comments: issues,
    openBody: pullBody, url: 'html_url', head: pullHead, openQuery: 'state=open', auth: 'token', pageSizeKey: 'limit',
    protectedRefusal: (s) => /not allowed to push to protected branch/i.test(s),
    restFacts: {
      listQuery: 'state=all',
      state: (p) => p.merged === true || p.merged_at ? 'merged' : p.state === 'open' || p.state === 'closed' ? p.state : null,
      identity: (path) => `/repos/${path}`, ownerId: (p) => p.owner?.id,
      commits: (path, n) => `${pulls(path)}/${n}/commits`,
      commit: (c) => ({ oid: c.sha, date: c.commit?.committer?.date, message: c.commit?.message, parent: c.parents?.[0]?.sha, tree: c.commit?.tree?.sha }),
      checks: (path, oid) => `/repos/${path}/statuses/${oid}`, conclusion: (c) => status(c.status),
      user: (c) => c.user, author: (u) => u.login, reviewDate: (c) => c.submitted_at ?? c.created_at,
      reviews: (path, n) => `${pulls(path)}/${n}/reviews`,
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
  return (repo: ForgeRepo, opts?: ForgeOptions) => forgeClient(repo, opts, {
    facts, github,
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
    async comment(number, body) {
      if (!prNumber(number)) throw new Error('invalid PR number');
      const prUrl = `${repo.webBase}${FORGE_SHAPES[repo.forge].pr}${number}`;
      if (cli) return commentUrl(prUrl, cli(['pr', 'comment', prUrl, '--body', body]));
      const response = await api.request(adapter.comments(path, number), { body });
      if (typeof response?.html_url === 'string') return commentUrl(prUrl, response.html_url);
      if (!prNumber(response?.id)) throw new Error(`${repo.forge} answered no comment id`);
      return `${prUrl}#${adapter.restFacts?.reviews ? 'issuecomment-' : 'note_'}${response.id}`;
    },
    async facts(read) {
      if (!reader) throw new Error('no fact context');
      if (!adapter.restFacts) return reader.github(repo, read, token());
      return readRestFacts(repo, read, reader.facts, adapter, api.request, all);
    },
    protectedRefusal: adapter.protectedRefusal,
  };
}

/** Compatibility for a detached test or older runner without repository coordinates. */
export function listCli(run: (args: string[]) => string, repository?: string): ReturnType<typeof openRef>[] {
  const text = run(['pr', 'list', '--state', 'open', '--limit', '300', '--json', 'number,headRefName,headRefOid', ...(repository ? ['--repo', repository] : [])]);
  let items: unknown;
  try { items = JSON.parse(text); } catch { /* diagnosed below */ }
  if (!Array.isArray(items) || items.length > 300) throw new Error(`gh pr list answered no PR list: ${text.slice(0, 200)}`);
  return items.map((p) => openRef(p?.number, p?.headRefName, p?.headRefOid));
}

function commentUrl(prUrl: string, url: string): string {
  if (url.length > 1000 || url.split('#')[0] !== prUrl || !/^#[A-Za-z0-9_-]+$/.test(new URL(url).hash)) throw new Error('forge answered no comment URL on the requested PR');
  return url;
}
