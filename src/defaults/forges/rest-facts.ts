import type { PrFact } from '../course-pr';
import type { BranchCommit } from '../pr-markers';
import { opened, sha } from './rest';
import type { FactContext, FactRead, ForgeRepo, OpenPrRef } from './types';

export interface RestFactShape {
  listQuery?: string;
  state: (p: any) => PrFact['state'] | null;
  identity: (path: string) => string;
  ownerId: (p: any) => unknown;
  commits: (path: string, n: number) => string;
  commit: (c: any) => { oid: unknown; date: string; message: unknown; parent: unknown; tree?: unknown };
  checks: (path: string, oid: string) => string;
  conclusion: (c: any) => string | null;
  reviews?: (path: string, n: number) => string;
  user: (c: any) => any;
  author: (u: any) => unknown;
  reviewDate: (c: any) => string;
}

interface FactAdapter {
  restFacts?: RestFactShape;
  prs: (path: string) => string;
  comments: (path: string, n: number) => string;
  url: string;
  head: (pr: any) => OpenPrRef;
}

export async function readRestFacts(repo: ForgeRepo, read: FactRead, ctx: FactContext, adapter: FactAdapter,
  get: (path: string) => Promise<any>, list: (path: string) => Promise<any[]>): Promise<PrFact[]> {
  const shape = adapter.restFacts!;
  const path = repo.path;
  if (read.entry) {
    const ids = await get(shape.identity(path));
    if (String(ids?.id) !== read.entry.repo_id || String(shape.ownerId(ids)) !== read.entry.owner_id) {
      throw new Error(`${path}: forge ids differ from code_repos (R-BTN-138)`);
    }
  }
  const host = new URL(repo.webBase).host;
  const pushers = new Set(ctx.pushers.filter((p) => p.host === host).map((p) => p.id));
  const out: PrFact[] = [];
  for (const p of await list(`${adapter.prs(path)}${shape.listQuery ? `?${shape.listQuery}` : ''}`)) {
    const { number, headRefName: head, headRefOid: oid } = adapter.head(p);
    const state = shape.state(p);
    if (!state) throw new Error(`${path} #${number}: invalid PR state`);
    const fact: PrFact = { number, head, state, repository: path, url: opened(repo, p[adapter.url]), pushedAt: 0, reviews: [], checks: [] };
    if (ctx.owns({ number, head, repository: path })) {
      const raw = (await list(shape.commits(path, number))).map(shape.commit);
      const trees = new Map(raw.map((c) => [c.oid, c.tree]));
      fact.commits = raw.map((c): BranchCommit => {
        const at = Date.parse(c.date);
        if (!sha(c.oid) || !Number.isFinite(at)) throw new Error(`${path} #${number}: invalid commit facts`);
        return { sha: c.oid, at, parent: sha(c.parent) ? c.parent : null, empty: sha(c.tree) && c.tree === trees.get(c.parent), message: typeof c.message === 'string' ? c.message.slice(0, 16_384) : '' };
      }).sort((a, b) => a.at - b.at);
      // No author is inferred to be a pusher from an association or project role.
      // Until the forge can attest base-ref write permission, only listed immutable ids count.
      const add = (c: any, user: any, state: PrFact['reviews'][number]['state']) => {
        const author = shape.author(user ?? {});
        const submittedAt = Date.parse(shape.reviewDate(c));
        if (!pushers.has(String(user?.id)) || typeof author !== 'string' || author.length > 128 || !Number.isFinite(submittedAt)) return;
        fact.reviews.push({ author, state, submittedAt, body: typeof c.body === 'string' ? c.body.slice(0, 16_384) : '' });
      };
      for (const c of await list(adapter.comments(path, number))) add(c, shape.user(c), 'COMMENTED');
      if (shape.reviews) {
        for (const c of await list(shape.reviews(path, number))) {
          if (c.dismissed || c.stale) continue;
          if (c.state === 'APPROVED' || c.state === 'REQUEST_CHANGES' || c.state === 'COMMENT') {
            add(c, shape.user(c), c.state === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : c.state === 'COMMENT' ? 'COMMENTED' : 'APPROVED');
          }
        }
      }
      fact.checks = (await list(shape.checks(path, oid))).map(shape.conclusion);
      fact.pushes = fact.commits.map((c) => c.at);
      fact.pushedAt = Math.max(0, ...fact.pushes);
    }
    out.push(fact);
  }
  return out;
}
