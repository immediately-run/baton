// reads/repository.ts — the repository and owner reads that existed for keys before B-192, now
// one entry each in src/core/actions.ts with a session beside the keys: the board, the blocks,
// the history, a ticket and its children, a leg's runs, the policy, the stats, the conditions,
// and the owner's grants and policy log. The dispatcher supplies one principal, one
// authorization, the ETag and the R-BTN-113 projection for session capabilities (./index.ts).
import { repositoryRead } from '../routes/public';
import { BatonError, json } from '../http';
import { STATS_WINDOW_MS } from '../stats';
import { withCredentials } from './credentials';
import { conditionsList } from './conditions';
import type { ReadRoute } from './kit';

/** The eight reads `BatonCore.repositoryRead` serves, by the path. */
const legacy = (action: string, over: Partial<ReadRoute> = {}): ReadRoute => ({
  action,
  clock: true,
  run: async (cx, call) => (await repositoryRead(cx.core, call.req, call.url, call.repository!, call.principal, call.sessionLink))
    ?? (() => { throw new BatonError('not-found', `no route GET ${call.url.pathname}`); })(),
  ...over,
});

export const REPOSITORY_READS: ReadRoute[] = [
  // The board shows the holders' lease ends, and the policy read its own instant: the clock's.
  legacy('repo.board'),
  legacy('repo.policy'),
  legacy('repo.blocked'),
  // `ticket.show` is served by ./tickets.ts (B-218): B-126's answer, extended.
  legacy('ticket.children', { clock: false }),
  legacy('ticket.history', { clock: false }),
  legacy('leg.runs'),
  legacy('leg.why', { etag: false }),
  // `?runner=me` is a runner session's own answer, decided by its secret after authorization:
  // never conditional, so a `304` is never answered where the secret would have been refused.
  legacy('ticket.blocks', { etag: (call) => !call.url.searchParams.has('runner') && !call.url.searchParams.has('worker') }),
  {
    // §5, §14: a course's record — aggregates and ids only (G-BTN-64), over a window the clock ends.
    action: 'repo.stats',
    clock: true,
    run(cx, call) {
      const raw = call.url.searchParams.get('since');
      const now = cx.now();
      const since = raw == null ? now - STATS_WINDOW_MS : Date.parse(raw);
      if (!Number.isFinite(since) || since > now) throw new BatonError('invalid-params', 'since: must be an ISO time not in the future');
      return { ok: true, ...cx.core.stats.of(call.repository!, since, now) };
    },
  },
  {
    // R-BTN-163 (B-234): the conditions list — what a delivery runner polls
    // (`?open=1&type=interact`, R-BTN-195) and the Conditions screen draws. Its own `?cursor=`
    // stays (B-205: existing reads keep their paging).
    action: 'repo.conditions',
    clock: true,
    // B-195: each entry also carries its `outcome`, `closed_at` and `resolve_url` (./conditions.ts).
    run: (cx, call) => conditionsList(cx, call),
  },
  {
    // R-BTN-146 (B-90): the repository's owner keys, grants, settings and bars — its owners'
    // read, and a session's. `server_time` rides in the body, so the clock is the ETag's.
    action: 'owner.grant.list',
    clock: true,
    // B-199: the credential and governance screens' fields ride beside them (./credentials.ts).
    run: (cx, call) => json(withCredentials(cx, call.repository!, cx.core.grantsView(call.repository!))),
  },
  {
    // R-BTN-188: the policy's versions.
    action: 'owner.policy.log',
    run(cx, call) {
      const after = Number(call.url.searchParams.get('after') ?? 0);
      if (!Number.isInteger(after) || after < 0) throw new BatonError('invalid-params', 'after: must be a version number');
      return { versions: cx.core.policies.log(call.repository!, after) };
    },
  },
];
