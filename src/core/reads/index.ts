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
import { hiddenSessionLink, type SessionLinkView } from '../links';
import { sha256Hex } from '../runnerApi';
import { BatonError, json, noStore } from '../http';
import { matchActions } from '../actions';
import { clockBucket, ifNoneMatch, stateEtag } from '../stateVersion';
import { checkRepositoryId } from '../validate';
import { authorizeAction, authorizeRepository, callerKey, type ReadCall, type ReadCtx, type ReadRoute } from './kit';
import { REPOSITORY_READS } from './repository';
import { SHELL_READS } from './repositories';
import { INSTANCE_READS } from './tenant';
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
  ...INSTANCE_READS,
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

/** One path segment, decoded: a malformed escape is the caller's error, never a 500. */
function decoded(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new BatonError('invalid-params', 'a malformed path segment');
  }
}

type ReportingRunner = { id: number; incarnation: number };

/** B-205: the strong ETag of this call's answer — the state version, the caller, the action,
 *  its path and its query, and the clock's coarse bucket where the read shows what the clock
 *  decides — through B-242's one helper. Decided after authorization and before the read. */
export function etagOf(cx: ReadCtx, call: ReadCall, route: ReadRoute, runner: ReportingRunner | null = null): string {
  const query = new URLSearchParams(call.url.searchParams);
  // Sort by name only: readers using get() care about the order of repeated values.
  query.sort();
  const caller = callerKey(call.principal) + (runner === null ? '' : `:runner:${runner.id}:${runner.incarnation}`);
  const projection = call.showInteractionLinks ? 'interaction-links' : 'redacted';
  return stateEtag(cx.store, caller, `${call.action.id}\n${call.url.pathname}\n${query}\n${projection}`, route.clock ? clockBucket(cx.now()) : null, !route.quiet);
}

/** Optional R-BTN-14 proof, without refreshing liveness on a read. */
async function reportingRunner(cx: ReadCtx, cred: string, req: Request): Promise<ReportingRunner | null> {
  const secret = req.headers.get('X-Runner-Secret');
  const legacy = req.headers.get('X-Worker-Secret');
  if (secret !== null && legacy !== null && secret !== legacy) return null;
  const proof = secret ?? legacy;
  if (!proof) return null;
  // Refuse an ambiguous proof rather than choosing between sessions with the same hash.
  const owners = cx.sql<ReportingRunner & { reaped_at: number | null }>(
    'SELECT id, incarnation, reaped_at FROM runners WHERE credential_id = ? AND secret_hash = ? LIMIT 2', cred, await sha256Hex(proof));
  return owners.length === 1 && owners[0].reaped_at === null ? owners[0] : null;
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
  const who = await cx.core.readPrincipal(req);
  const caller = authorizeAction(who.principal, hit.action);
  const params = Object.fromEntries(Object.entries(hit.params).map(([k, v]) => [k, decoded(v)]));
  let repository: string | null = null;
  if ('repository' in params) {
    repository = checkRepositoryId(params.repository);
  }
  const principal = who.principal;
  const runner = principal.kind === 'key' && principal.role === 'runner'
    ? await reportingRunner(cx, principal.cred, who.req) : null;
  if (repository !== null) authorizeRepository(cx, principal, repository);
  const sessionLink: SessionLinkView = (link, holder, incarnation) =>
    link !== null && (principal.kind === 'session' || (runner?.id === holder && runner.incarnation === incarnation))
      ? { session_url: link, session_link: true } : hiddenSessionLink(link, holder, incarnation);
  const open = url.searchParams.get('open');
  const deliverInteractions = hit.action.id === 'repo.conditions' && principal.kind === 'key' && principal.role === 'runner'
    && repository !== null && (open === '1' || open === 'true') && url.searchParams.get('type') === 'interact'
    && cx.sql(`SELECT 1 FROM runner_grants WHERE credential_id = ? AND repository_id = ?
               AND revoked_at IS NULL AND deliver_interactions = 1`, principal.cred, repository).length > 0;
  const call: ReadCall = { action: hit.action, principal, caller, repository, params, url, req: who.req, sessionLink, showInteractionLinks: principal.kind === 'session' || deliverInteractions };
  const conditional = route.etag === undefined ? true : route.etag === false ? false : route.etag(call);
  const etag = conditional ? etagOf(cx, call, route, runner) : null;
  if (etag && ifNoneMatch(req, etag)) return noStore(new Response(null, { status: 304, headers: { ETag: etag } }));
  const out = await route.run(cx, call);
  const res = out instanceof Response ? out : json(out);
  if (etag && res.ok) res.headers.set('ETag', etag);
  const reply = noStore(res);
  return req.method === 'HEAD' ? new Response(null, { status: reply.status, headers: reply.headers }) : reply;
}
