import type { PrFact } from '../course-pr';
import { markerOf, type BranchCommit } from '../pr-markers';
import { field, immutableId, opened, sha, type rest } from './rest';
import type { FactContext, FactRead, ForgeRepo, OpenPrRef } from './types';

/** How a REST forge's answers read as PR facts. Each reader takes the forge's untrusted JSON. */
export interface RestFactShape {
  listQuery?: string;
  state: (p: unknown) => PrFact['state'] | null;
  identity: (path: string) => string;
  ownerId: (p: unknown) => unknown;
  commits: (path: string, n: number) => string;
  commit: (c: unknown) => { oid: unknown; date: unknown; message: unknown; parent: unknown; tree?: unknown };
  checks: (path: string, oid: string) => string;
  checkItems?: (p: unknown) => unknown;
  conclusion: (c: unknown) => string | null;
  reviews?: (path: string, n: number) => string;
  user: (c: unknown) => unknown;
  author: (u: unknown) => unknown;
  reviewDate: (c: unknown) => unknown;
  permission: (path: string, id: number, login: string) => string;
  canPush: (p: unknown, id: number) => boolean;
  scopeRefusal: (message: string) => boolean;
  gitTrees?: boolean;
  newestCommitFirst?: boolean;
  treeOf?: (path: string, oid: string) => string;
  unpagedComments?: boolean;
}

interface FactAdapter {
  restFacts?: RestFactShape;
  prs: (path: string) => string;
  comments: (path: string, n: number) => string;
  url: string;
  head: (pr: unknown) => OpenPrRef;
}

/** `Date.parse` reads its argument as a string; this says so for an untrusted value. */
const time = (v: unknown): number => Date.parse(String(v));

export async function readRestFacts(repo: ForgeRepo, read: FactRead, ctx: FactContext, adapter: FactAdapter,
  api: ReturnType<typeof rest>, pageSizeKey: string | undefined, canPush: (id: unknown, login: string) => Promise<boolean>): Promise<PrFact[]> {
  const list = (path: string) => api.list(path, pageSizeKey);
  const shape = adapter.restFacts!;
  const path = repo.path;
  if (read.entry) {
    const ids = await api.request(shape.identity(path));
    if (String(field(ids, 'id')) !== read.entry.repo_id || String(shape.ownerId(ids)) !== read.entry.owner_id) {
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
    const fact: PrFact = { number, head, state, repository: path, sameRepository, headOid: oid, url: opened(repo, field(p, adapter.url)), pushedAt: 0, reviews: [], checks: [] };
    if (ctx.owns(fact)) {
      const raw = (await list(shape.commits(path, number))).map(shape.commit);
      const trees = new Map(raw.map((c) => [c.oid, c.tree]));
      const commits = raw.map((c): BranchCommit => {
        const at = time(c.date);
        if (!sha(c.oid) || !Number.isFinite(at)) throw new Error(`${path} #${number}: invalid commit facts`);
        return { sha: c.oid, at, parent: sha(c.parent) ? c.parent : null, empty: sha(c.tree) && c.tree === trees.get(c.parent), message: typeof c.message === 'string' ? c.message.slice(0, 16_384) : '' };
      });
      // The branch gate reads Git history order, not committer timestamps.
      if (shape.newestCommitFirst) commits.reverse();
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
      const add = async (c: unknown, user: unknown, state: PrFact['reviews'][number]['state']) => {
        const author = shape.author(user ?? {});
        const submittedAt = time(shape.reviewDate(c));
        if (typeof author !== 'string' || !author || author.length > 128 || !Number.isFinite(submittedAt)) return;
        const userId = field(user, 'id');
        const updatedAt = field(c, 'updated_at');
        // An edit with no attributable writer cannot be a verdict (R-BTN-139).
        if (updatedAt != null && updatedAt !== (field(c, 'created_at') ?? field(c, 'submitted_at'))
            && (!immutableId(userId) || field(c, 'updated_by', 'id') !== userId)) return;
        if (!pushers.has(String(userId)) && !await canPush(userId, author)) return;
        const body = field(c, 'body');
        fact.reviews.push({ author, state, submittedAt, body: typeof body === 'string' ? body.slice(0, 16_384) : '' });
      };
      const comments = adapter.comments(path, number);
      for (const c of await (shape.unpagedComments ? api.unpaged(comments) : list(comments))) await add(c, shape.user(c), 'COMMENTED');
      if (shape.reviews) {
        for (const c of await list(shape.reviews(path, number))) {
          if (field(c, 'dismissed') || field(c, 'stale')) continue;
          const verdict = field(c, 'state');
          if (verdict === 'APPROVED' || verdict === 'REQUEST_CHANGES' || verdict === 'COMMENT') {
            await add(c, shape.user(c), verdict === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : verdict === 'COMMENT' ? 'COMMENTED' : 'APPROVED');
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
