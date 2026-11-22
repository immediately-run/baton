// reads/index.ts — the one place a read is dispatched (B-192, B-205): every GET a dashboard
// session may call, and every read a session shares with the keys.
//
// HOW TO ADD A READ
//   1. Add its entry to src/core/actions.ts — `id`, `summary`, `effect: 'read'`, `http: {method:
//      'GET', path}` with `{param}` segments (name the repository `{repository}`), `callers`
//      (`REPOSITORY_READERS` for a repository read; `SESSION_ADMIN`-style for a tenant read) and
//      `input` (its query parameters). The front admits the cookie and the keys from that entry
//      alone: neither front.ts nor baton.ts changes.
//   2. Write the read in a module here (one per domain) exporting `ReadRoute[]`: each names its
//      `action` id and a `run(cx, call)` returning the JSON body. `call.principal` is who reads,
//      `call.repository` the checked `{repository}`, `call.params` the decoded path parameters,
//      `call.url` the query. `cx.core` is the core (its public modules and views), `cx.sql` a
//      query, `cx.now()` the only clock. Set `clock: true` when the answer shows anything the
//      clock decides (alive, stalled, a deadline, a time window).
//   3. Add the module's list to `READS` below — one line.
// What the dispatcher has done before `run`: resolved the principal (`BatonCore.readPrincipal`:
// a key's signature or API key first, else the session), refused a caller the entry does not
// list (`forbidden`), refused a `{repository}` the caller cannot read — unowned, ungranted,
// unregistered, retired — with the one `forbidden`, and answered `304` to a matching
// `If-None-Match`. What `run` owes: `not-found` for an entity id absent from a readable
// repository; `invalid-params` for a bad query (`queryOf(call)` refuses unknown parameters);
// for a list, the convention `{<items>: [...], next_cursor?, counts?}` with `cursorOf` and
// `pageOf` (./kit.ts), timestamps as epoch milliseconds; filter fields only (R-BTN-33). A read
// writes nothing.
import { pathSegment } from '../routes/kit';
import { readPrincipal } from '../routes/principal';
import { BatonError, json } from '../http';
import { matchActions } from '../actions';
import { clockBucket, ifNoneMatch, stateEtag } from '../stateVersion';
import { checkRepositoryId } from '../validate';
import { authorizeAction, authorizeRepository, callerKey, type ReadCall, type ReadCtx, type ReadRoute } from './kit';
import { REPOSITORY_READS } from './repository';
import { SHELL_READS } from './repositories';
import { TENANT_READS } from './tenant';
import { COURSE_READS } from './courses';
import { TICKET_READS } from './tickets';
import { RUNNER_READS } from './runners';
import { COURSE_SHOW_READS } from './course';
import { CONDITION_READS } from './conditions';
import { SYNC_READS } from './sync';
import { ATTESTATION_READS } from './attestations';

/** Every read served through here. A later domain appends its list — one line. */
export const READS: ReadRoute[] = [
  ...SHELL_READS,
  ...TENANT_READS,
  ...REPOSITORY_READS,
  ...COURSE_READS,
  ...TICKET_READS,
  ...RUNNER_READS,
  ...COURSE_SHOW_READS,
  ...CONDITION_READS,
  ...SYNC_READS,
  ...ATTESTATION_READS,
];

let byAction: Map<string, ReadRoute> | null = null;
function routeOf(action: string): ReadRoute | undefined {
  byAction ??= new Map(READS.map((r) => [r.action, r]));
  return byAction.get(action);
}

/** B-205: the strong ETag of this call's answer — the state version, the caller, the action,
 *  its path and its query, and the clock's coarse bucket where the read shows what the clock
 *  decides — through B-242's one helper. Decided after authorization and before the read. */
export function etagOf(cx: ReadCtx, call: ReadCall, route: ReadRoute): string {
  const query = [...call.url.searchParams].map(([k, v]) => `${k}=${v}`).sort().join('&');
  return stateEtag(cx.store, callerKey(call.principal), `${call.action.id}\n${call.url.pathname}\n${query}`, route.clock ? clockBucket(cx.now()) : null, !route.quiet);
}

/** Serve `req` if it is a read registered here; null otherwise, and the core's older routes
 *  take it. `HEAD` is answered as `GET`, with no body. */
export async function dispatchRead(cx: ReadCtx, req: Request, url: URL): Promise<Response | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const hit = matchActions('GET', url.pathname).find((h) => routeOf(h.action.id));
  if (!hit) return null;
  const route = routeOf(hit.action.id)!;
  // One principal, then the one check (R-BTN-129): the caller against the entry, then the
  // repository the path names.
  const who = await readPrincipal(cx.core, req);
  const caller = authorizeAction(who.principal, hit.action);
  const params = Object.fromEntries(Object.entries(hit.params).map(([k, v]) => [k, pathSegment(v)]));
  let repository: string | null = null;
  if ('repository' in params) {
    repository = checkRepositoryId(params.repository);
    authorizeRepository(cx, who.principal, repository);
  }
  const call: ReadCall = { action: hit.action, principal: who.principal, caller, repository, params, url, req: who.req };
  const conditional = route.etag === undefined ? true : route.etag === false ? false : route.etag(call);
  const etag = conditional ? etagOf(cx, call, route) : null;
  if (etag && ifNoneMatch(req, etag)) return new Response(null, { status: 304, headers: { ETag: etag } });
  const out = await route.run(cx, call);
  const res = out instanceof Response ? out : json(out);
  if (etag && res.ok) res.headers.set('ETag', etag);
  return req.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
