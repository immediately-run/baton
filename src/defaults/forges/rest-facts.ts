import type { PrFact } from '../course-pr';
import { markerOf, type BranchCommit } from '../pr-markers';
import { immutableId, opened, sha, type rest } from './rest';
import type { FactContext, FactRead, ForgeRepo, OpenPrRef } from './types';

export interface RestFactShape {
  listQuery?: string;
  state: (p: any) => PrFact['state'] | null;
  identity: (path: string) => string;
  ownerId: (p: any) => unknown;
  commits: (path: string, n: number) => string;
  commit: (c: any) => { oid: unknown; date: string; message: unknown; parent: unknown; tree?: unknown };
  checks: (path: string, oid: string) => string;
  checkItems?: (p: any) => unknown;
  conclusion: (c: any) => string | null;
  reviews?: (path: string, n: number) => string;
  user: (c: any) => any;
  author: (u: any) => unknown;
  reviewDate: (c: any) => string;
  permission: (path: string, id: number, login: string) => string;
  canPush: (p: any, id: number) => boolean;
  scopeRefusal: (message: string) => boolean;
  gitTrees?: boolean;
  treeOf?: (path: string, oid: string) => string;
  unpagedComments?: boolean;
}

interface FactAdapter {
  restFacts?: RestFactShape;
  prs: (path: string) => string;
  comments: (path: string, n: number) => string;
  url: string;
  head: (pr: any) => OpenPrRef;
}

export async function readRestFacts(repo: ForgeRepo, read: FactRead, ctx: FactContext, adapter: FactAdapter,
  api: ReturnType<typeof rest>, pageSizeKey: string | undefined, canPush: (id: unknown, login: string) => Promise<boolean>): Promise<PrFact[]> {
  const list = (path: string) => api.list(path, pageSizeKey);
  const shape = adapter.restFacts!;
  const path = repo.path;
  if (read.entry) {
    const ids = await api.request(shape.identity(path));
    if (String(ids?.id) !== read.entry.repo_id || String(shape.ownerId(ids)) !== read.entry.owner_id) {
      throw new Error(`${path}: forge ids differ from code_repos (R-BTN-138)`);
    }
  }
  const host = new URL(repo.webBase).host;
  const pushers = new Set(ctx.pushers.filter((p) => p.host === host).map((p) => p.id));
  const out: PrFact[] = [];
  for (const p of await list(`${adapter.prs(path)}${shape.listQuery ? `?${shape.listQuery}` : ''}`)) {
    const { number, headRefName: head, headRefOid: oid, sameRepository } = adapter.head(p);
    const state = shape.state(p);
    if (!state) throw new Error(`${path} #${number}: invalid PR state`);
    const fact: PrFact = { number, head, state, repository: path, sameRepository, headOid: oid, url: opened(repo, p[adapter.url]), pushedAt: 0, reviews: [], checks: [] };
    if (ctx.owns(fact)) {
      const raw = (await list(shape.commits(path, number))).map(shape.commit);
      const trees = new Map(raw.map((c) => [c.oid, c.tree]));
      const commits = raw.map((c): BranchCommit => {
        const at = Date.parse(c.date);
        if (!sha(c.oid) || !Number.isFinite(at)) throw new Error(`${path} #${number}: invalid commit facts`);
        return { sha: c.oid, at, parent: sha(c.parent) ? c.parent : null, empty: sha(c.tree) && c.tree === trees.get(c.parent), message: typeof c.message === 'string' ? c.message.slice(0, 16_384) : '' };
      }).sort((a, b) => a.at - b.at);
      if (!shape.gitTrees) {
        for (const c of commits) {
          const tree = trees.get(c.sha);
          if (shape.treeOf && c.parent && sha(tree) && !trees.has(c.parent) && markerOf({ ...c, empty: true })) {
            const parent = shape.commit(await api.request(shape.treeOf(path, c.parent)));
            if (parent.oid !== c.parent || !sha(parent.tree)) throw new Error(`${path} #${number}: invalid parent tree facts`);
            trees.set(c.parent, parent.tree);
            c.empty = tree === parent.tree;
          }
        }
        fact.commits = commits;
      }
      const add = async (c: any, user: any, state: PrFact['reviews'][number]['state']) => {
        const author = shape.author(user ?? {});
        const submittedAt = Date.parse(shape.reviewDate(c));
        if (typeof author !== 'string' || !author || author.length > 128 || !Number.isFinite(submittedAt)) return;
        // An edit with no attributable writer cannot be a verdict (R-BTN-139).
        if (c.updated_at != null && c.updated_at !== (c.created_at ?? c.submitted_at)
            && (!immutableId(user?.id) || c.updated_by?.id !== user.id)) return;
        if (!pushers.has(String(user?.id)) && !await canPush(user?.id, author)) return;
        fact.reviews.push({ author, state, submittedAt, body: typeof c.body === 'string' ? c.body.slice(0, 16_384) : '' });
      };
      const comments = adapter.comments(path, number);
      for (const c of await (shape.unpagedComments ? api.unpaged(comments) : list(comments))) await add(c, shape.user(c), 'COMMENTED');
      if (shape.reviews) {
        for (const c of await list(shape.reviews(path, number))) {
          if (c.dismissed || c.stale) continue;
          if (c.state === 'APPROVED' || c.state === 'REQUEST_CHANGES' || c.state === 'COMMENT') {
            await add(c, shape.user(c), c.state === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : c.state === 'COMMENT' ? 'COMMENTED' : 'APPROVED');
          }
        }
      }
      fact.checks = (await api.list(shape.checks(path, oid), pageSizeKey, shape.checkItems)).map(shape.conclusion);
      fact.pushes = commits.map((c) => c.at);
      fact.pushedAt = Math.max(0, ...fact.pushes);
    }
    out.push(fact);
  }
  return out;
}
