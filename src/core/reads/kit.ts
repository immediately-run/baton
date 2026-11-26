// reads/kit.ts — what a read module is written with (B-192, B-205): the principal a read's
// caller resolves to, the one authorization of a principal against an action and a repository,
// and the helpers a list read pages with. See ./index.ts for how to add a read.
import { hasGrant } from '../grants';
import type { SessionLinkView } from '../links';
import { BatonError } from '../http';
import { callerFor, type Action, type ActionPrincipal, type Caller, type SessionRole } from '../actions';
import { checkCursor, mintCursor, page, PAGE_DEFAULT, type CursorBinding } from '../cursor';
import { liveness } from '../stateVersion';
import type { BatonCore } from '../baton';
import type { Config, Row, Store } from '../ports';

/** Who reads (B-192). A session authorizes with its minting key's role (R-BTN-155): `id` is
 *  that key's fingerprint, and `repositories` the ones an owner's session reaches — null for an
 *  administrator's, which reaches every live one. A key is an administrator's, an owner's or a
 *  runner's (a machine key, an API key or the transition's bearer). */
export type ReadPrincipal =
  | { kind: 'session'; role: SessionRole; id: string; repositories: string[] | null }
  | { kind: 'key'; role: 'admin' | 'owner' | 'runner'; cred: string };

/** What a read module reaches the core through: the core itself (its public modules —
 *  `core.claims`, `core.runners`, `core.conditions`, `core.registry`, … — and its public views),
 *  one SQL helper, the clock (R-BTN-32: the only one) and the host's config. */
export type ReadCtx = {
  core: BatonCore;
  store: Store;
  sql<T = Row>(query: string, ...params: unknown[]): T[];
  now(): number;
  config: Config;
};

/** One authorized call of a read. */
export type ReadCall = {
  action: Action;
  sessionLink: SessionLinkView;
  /** A dashboard session or the authorized R-BTN-195 delivery poll. */
  showInteractionLinks: boolean;
  principal: ReadPrincipal;
  /** The entry's caller the principal matched. */
  caller: Caller;
  /** The `{repository}` of the path, checked live and readable by the principal; null for a
   *  read whose path names none. */
  repository: string | null;
  /** The path's parameters, decoded. */
  params: Record<string, string>;
  url: URL;
  req: Request;
};

/** A read as its module registers it (./index.ts's list). */
export type ReadRoute = {
  /** The entry's id in src/core/actions.ts: its method, path pattern and callers are there. */
  action: string;
  /** True where the answer shows anything the clock decides — alive, stalled, `reap_at`, a
   *  lapse, a time window: the ETag then folds in B-242's coarse clock bucket. */
  clock?: boolean;
  /** True where the answer is built from no activity row (activities, transcripts, messages,
   *  events, ticket history) that could change without another table changing with it: its
   *  ETag then stands through runners' reports (B-287, S-BTN-243). */
  quiet?: boolean;
  /** False — or a predicate answering false for this call — where the answer must not be
   *  conditional (a read that does a check of its own after authorization). */
  etag?: false | ((call: ReadCall) => boolean);
  /** The read. Runs after the principal is resolved, the caller authorized and — where the
   *  request named a matching `If-None-Match` — not at all. Returns the JSON body, or a
   *  `Response` when it builds its own. */
  run(cx: ReadCtx, call: ReadCall): unknown | Response | Promise<unknown | Response>;
};

/** The principal as an ETag's and a cursor's caller: one caller's are never another's. */
export const callerKey = (p: ReadPrincipal): string => (p.kind === 'session' ? `session:${p.role}:${p.id}` : `key:${p.role}:${p.cred}`);

/** The entry's caller `principal` matches — R-BTN-129's first half of `authorize` — or
 *  `forbidden`: a known caller the action does not list (§12.1). */
export function authorizeAction(principal: ActionPrincipal, action: Action): Caller {
  const caller = callerFor(action, principal);
  if (!caller) throw new BatonError('forbidden', `${action.id} is not this caller's to call`);
  return caller;
}

/** The one refusal (B-191, B-192): a repository the caller cannot read — unowned, ungranted,
 *  unregistered or retired — answers this, the same for each, so no read is an existence oracle. */
export const notYours = (): BatonError => new BatonError('forbidden', 'this repository is not yours or does not exist');

/** May `principal` read `repository`? An administrator — a key or a session — every live one;
 *  an owner key the ones it owns; an owner's session the ones its key still owns (written for
 *  B-76: no owner session exists yet); a runner key the ones a live grant binds it to. */
export function canRead(cx: ReadCtx, principal: ReadPrincipal, repository: string): boolean {
  if (!cx.core.registry.live(repository)) return false;
  if (principal.kind === 'session') {
    if (principal.role === 'administrator') return true;
    return (principal.repositories ?? []).includes(repository) && cx.core.admin.owns(principal.id, repository);
  }
  if (principal.role === 'admin') return true;
  if (principal.role === 'owner') return cx.core.admin.owns(principal.cred, repository);
  return hasGrant(cx.store, principal.cred, repository);
}

/** `canRead`, or the one refusal. */
export function authorizeRepository(cx: ReadCtx, principal: ReadPrincipal, repository: string): void {
  if (!canRead(cx, principal, repository)) throw notYours();
}

/** The live repositories `principal` reads, by id — what an instance-scoped list answers. */
export function readableRepositories(cx: ReadCtx, principal: ReadPrincipal): string[] {
  return cx.core.registry.all().map((r) => r.id).filter((id) => canRead(cx, principal, id));
}

/** The request's query as a read takes it: only the parameters named in the entry's `input`
 *  (and `cursor`), each given once — an unknown one is `invalid-params` (§14's convention). */
export function queryOf(call: ReadCall): Record<string, string> {
  const allowed = new Set([...Object.keys(call.action.input.properties), 'cursor']);
  const out: Record<string, string> = {};
  for (const [k, v] of call.url.searchParams) {
    if (!allowed.has(k)) throw new BatonError('invalid-params', `${k}: not a parameter of ${call.action.id}`);
    if (k in out) throw new BatonError('invalid-params', `${k}: given more than once`);
    out[k] = v;
  }
  return out;
}

/** The instance's `CursorKey` (R-BTN-55, R-BTN-130). No host binds a `BATON_CURSOR_KEY` yet
 *  (§2's table marks it not built), so the key is 32 random bytes the core makes once and keeps
 *  in `baton_settings` — the store both hosts already provide — written quietly: it is no
 *  state a reader keys on. A cursor is a paging convenience, never authority: every page is
 *  authorized again, so a key that changes (a moved tenant) costs a reader one restart. */
export function cursorKey(cx: ReadCtx): string {
  const held = cx.sql<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'cursor_key'`)[0]?.value;
  if (held) return held;
  const key = [...cx.core.random(32)].map((b) => b.toString(16).padStart(2, '0')).join('');
  liveness(cx.store, () => cx.store.exec(`INSERT INTO baton_settings (key, value) VALUES ('cursor_key', ?) ON CONFLICT(key) DO NOTHING`, key).toArray());
  return cx.sql<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'cursor_key'`)[0].value;
}

/** What a cursor of this call is bound to: the caller, the action, the path and the query. */
function bindingOf(call: ReadCall): CursorBinding {
  const query: Record<string, string> = { '': call.url.pathname };
  for (const [k, v] of call.url.searchParams) if (k !== 'cursor') query[k] = v;
  return { caller: callerKey(call.principal), action: call.action.id, query };
}

/** The position the call's `?cursor=` carries, or null on a first page; `invalid-params` for a
 *  cursor another caller, action, path or filter was given, and for a tampered one. */
export function cursorOf<T = unknown>(cx: ReadCtx, call: ReadCall): T | null {
  const cursor = call.url.searchParams.get('cursor');
  return cursor == null ? null : checkCursor<T>(cursorKey(cx), bindingOf(call), cursor);
}

/** A list read's page in §14's convention: hand it `limit + 1` rows and how a row names its
 *  position; it answers `{items, next_cursor?}` with the cursor bound to this call. Spread it
 *  under the read's own word: `const p = pageOf(…); return { tickets: p.items, next_cursor: p.next_cursor }`. */
export function pageOf<T>(cx: ReadCtx, call: ReadCall, rows: T[], position: (last: T) => unknown, limit = PAGE_DEFAULT): { items: T[]; next_cursor?: string } {
  return page(rows, limit, (last) => mintCursor(cursorKey(cx), bindingOf(call), position(last)));
}

export { PAGE_DEFAULT };
