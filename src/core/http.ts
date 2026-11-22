// http.ts — responses, errors and the R-BTN-16 headers (BATON_SPEC §10.5, §11), and the client
// versions Baton states on every /v1 response (R-BTN-197, B-254).
import { clientVersionsValue, maxVersion, parseVersion } from '../shared/versions.mjs';

/** Every response carries these (R-BTN-16): no framing, nothing loaded from elsewhere. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// ── the client versions Baton serves (§11.3 R-BTN-197, B-254) ───────────────────────────

/** R-BTN-197: every request the CLI sends names its version here (`baton/<version>`, `+dev` from
 *  a git working tree — B-138's guard). A claim, like a user agent: it decides only whether
 *  Baton answers `client-too-old`, before anything is read or written. */
export const CLIENT_HEADER = 'Baton-Client';
/** R-BTN-197: every response under `/v1` carries the versions Baton serves, `min=<version>,
 *  recommended=<version>` — version numbers only, never a location or a package, so no client
 *  can be steered by it into running something. */
export const VERSIONS_HEADER = 'Baton-Client-Versions';

/** R-BTN-197: the oldest client whose requests this code still reads. A constant of the code —
 *  raised only in the change that drops what an older client sends, 14 days after `recommended`
 *  reached the new value — and by nothing else: no deploy variable and no administrator setting
 *  touches it, so the code alone decides and `recommended` alone is raisable at runtime.
 *  `0.0.0` at first (B-254): nothing in the field is refused by this change. */
export const MIN_CLIENT = '0.0.0';

/** R-BTN-197: the version this code recommends its clients run — the release this change ships
 *  in. The floor `admin settings set --recommended-client` is validated against (validate.ts);
 *  an administrator may raise it, never below this. */
export const RECOMMENDED_CLIENT = '0.1.5';

/** The versions this deployment serves, as the front and the core state them (R-BTN-197): `min`
 *  is the code's `MIN_CLIENT` — a constant, with no deploy word for it — except under the test
 *  bindings (§13a), where `TEST_MIN_CLIENT` plays a Baton whose code has dropped what an older
 *  client sends, so S-BTN-227's old clients are refused (a broken value falls back to the
 *  constant). `recommended` is the caller's — the code's default, or the instance's raised one —
 *  clamped at or above `min` (R-BTN-197: `recommended` is at or above `min`), so a raised `min`
 *  can never name a window narrower than the code recommends. */
export function servedClientVersions(config: { BATON_TEST_BINDINGS?: string; TEST_MIN_CLIENT?: string }, recommended: string = RECOMMENDED_CLIENT): { min: string; recommended: string } {
  const raised = config.BATON_TEST_BINDINGS === 'true' ? config.TEST_MIN_CLIENT : undefined;
  const min = raised != null && raised !== '' && parseVersion(raised) ? raised : MIN_CLIENT;
  return { min, recommended: maxVersion(recommended, min) };
}

export type ErrorCode =
  | 'unauthenticated' | 'forbidden' | 'invalid-params' | 'not-found' | 'too-large'
  | 'head-moved' | 'snapshot-rejected' | 'stale-observation' | 'sync-busy' | 'unavailable' | 'internal'
  | 'session-taken' | 'runner-reaped' | 'claim-ended' | 'not-holder'
  | 'not-eligible' | 'no-eligible-ticket' | 'provider-suspended' | 'stale-skills' | 'backing-off' | 'not-cut-over' | 'conflict' | 'barred-tag' | 'blocked' | 'closed' | 'invalid-prerequisite'
  | 'client-too-old' // §11 (R-BTN-197): a Baton-Client below the served min
  | 'floor-violated' | 'unsatisfiable-approvers' | 'confirm-required' // §12.8 (B-145): the policy's refusals
  | 'capacity-full'
  | 'frozen' | 'sealed' // §4.8 (R-BTN-88): a claim or owner write on a frozen Baton; any request but an administrator's read on a sealed one
  | 'quota'; // §7.1 (R-BTN-160, B-234): past a raise's open-condition or daily quota

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401, forbidden: 403, 'invalid-params': 400, 'not-found': 404,
  'too-large': 413, // §11: a body over a route's cap (R-BTN-73's delivery routes), refused before it is read past it
  'head-moved': 409, 'snapshot-rejected': 409, 'stale-observation': 409, 'sync-busy': 409, unavailable: 503, internal: 500,
  'session-taken': 409, 'runner-reaped': 409, 'claim-ended': 409, 'not-holder': 409,
  'not-eligible': 409, 'no-eligible-ticket': 404, 'provider-suspended': 409, 'stale-skills': 409, 'backing-off': 409, 'barred-tag': 409,
  'not-cut-over': 409, conflict: 409, 'invalid-prerequisite': 409, // §11: a key in another role (R-BTN-57, R-BTN-93); R-BTN-126's invalid end
  'client-too-old': 426, // §11 (R-BTN-197): an old client's one refusal, before its signature is checked
  'capacity-full': 409, // §6.6 rule 11 (R-BTN-178): every seat of a capability is held
  blocked: 409, // an open dependency or decision (R-BTN-75, R-BTN-78)
  closed: 409, // a notice whose decision was answered (R-BTN-80)
  'floor-violated': 409, 'unsatisfiable-approvers': 409, // R-BTN-189's floor, R-BTN-188's unsatisfiable list
  'confirm-required': 428, // a destructive action without confirm: true (§14)
  frozen: 409, // §4.8 (R-BTN-88): new claims and owner writes on a frozen Baton
  sealed: 503, // §4.8 (R-BTN-88): a sealed Baton serves an administrator's reads alone — retryable elsewhere
  quota: 429, // §7.1 (R-BTN-160, B-234): past a raise's quota
};

/** Thrown anywhere below the router; the router turns it into the §11 error body. */
export class BatonError extends Error {
  /** `extra` rides in the error body beside `code` and `message` — `not-eligible` names its `rule` (§11). */
  constructor(readonly code: ErrorCode, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** R-BTN-197: the one refusal a client below `min` gets — naming its version, the served `min`
 *  and `recommended` — thrown where nothing of the request has been read or written. */
export function clientTooOld(client: string, min: string, recommended: string): BatonError {
  return new BatonError('client-too-old',
    `this client is ${client}; Baton serves min ${min}, recommended ${recommended} — update it at your own pace; no client updates itself`,
    { client, min, recommended });
}

/** `res` with the served versions set on it unless a value is already there — the core sets the
 *  header with the instance's raised `recommended`; the front fills what it builds itself with
 *  what it serves (R-BTN-197). Built like `noStore`: a copy, never a mutation. */
export function withClientVersions(res: Response, versions: { min: string; recommended: string }): Response {
  if (res.headers.get(VERSIONS_HEADER) != null) return res;
  const headers = new Headers();
  res.headers.forEach((v, k) => headers.set(k, v));
  headers.set(VERSIONS_HEADER, clientVersionsValue(versions));
  const { status } = res;
  const body = status === 101 || status === 204 || status === 205 || status === 304 ? null : res.body;
  return new Response(body, { status, statusText: res.statusText, headers });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function errorResponse(code: ErrorCode, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ ...extra, ok: false, code, message }, STATUS[code]);
}

/** A copy of `res` with the security headers set (responses from the object are immutable). */
export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

/** R-BTN-16: the one cookie Baton reads — its own dashboard session (R-BTN-57). */
export const SESSION_COOKIE = '__Host-baton_session';
/** R-BTN-16 (R-BTN-155): the pending sign-in a browser holds while a key holder types its code. */
export const PENDING_COOKIE = '__Host-baton_pending';

/** R-BTN-16: `Cache-Control: no-store` — the header every response to a request a credential or
 *  a dashboard session authorizes, and every response that hands out a cookie or carries a
 *  sign-in code, carries (the front sets it, where it decides each route; this is the one place
 *  its spelling lives). */
export const NO_STORE = 'no-store';

/** `res` with `Cache-Control: no-store` (R-BTN-16), built anew: a copy's headers are built from
 *  the original's without mutating either, and a status that carries no body is given none —
 *  a response exists in the realm it was made in, and its `body` is not always one the copying
 *  realm's `Response` accepts. */
export function noStore(res: Response): Response {
  if (res.headers.get('Cache-Control') === NO_STORE) return res;
  const headers = new Headers();
  res.headers.forEach((v, k) => headers.set(k, v));
  headers.set('Cache-Control', NO_STORE);
  const { status } = res;
  const body = status === 101 || status === 204 || status === 205 || status === 304 ? null : res.body;
  return new Response(body, { status, statusText: res.statusText, headers });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BatonError('invalid-params', 'the body is not JSON');
  }
}
