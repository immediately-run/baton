// front.ts — what stands in front of Baton's core (BATON_SPEC §3, §10): it verifies the
// principal for the path, applies the R-BTN-16 rules, serves the dashboard's static files, and
// forwards the API to the core — through the Durable Object on Cloudflare, through the request
// queue locally (R-BTN-55). Every response leaves with the security headers.
import { API_KEY, readCapped, verifyAccess, verifyOwner, verifyRequest, verifySyncCredential, verifyRunner, checkStateChanging, withBody } from './auth';
import { BatonError, CLIENT_HEADER, NO_STORE, SESSION_COOKIE, VERSIONS_HEADER, clientTooOld, errorResponse, noStore, servedClientVersions, withClientVersions, withSecurityHeaders } from './http';
import { MAX_DELIVERY, pickDelivery, verifyDelivery } from './webhook';
import { clientVersionOf, compareVersions, maxVersion, parseClientVersions } from '../shared/versions.mjs';
import type { Config } from './ports';
import { ID_SEGMENT, isScreenPath } from './screens';
import { keyReadable, sessionReadable } from './actions';
import { checkLogin } from './validate';
import page from '../dashboard/dist/index.html';
import style from '../dashboard/dist/app.css';
import script from '../dashboard/dist/app.js';

/** How the front reaches the one core (§3): the request carries only the principal headers
 *  the front set. */
export type Forward = (req: Request) => Promise<Response>;

/** The dashboard's two code assets (B-193): the one bundle `npm run build:ui` builds and this
 *  Worker and the local host embed as text (R-BTN-55) — never Workers assets. */
const ASSETS: Record<string, [string, string]> = {
  '/dashboard/app.css': [style, 'text/css; charset=utf-8'],
  '/dashboard/app.js': [script, 'text/javascript; charset=utf-8'],
};
const PAGE: [string, string] = [page, 'text/html; charset=utf-8'];

/** What anyone may fetch: the shell — `/`, `/login`, every §11.4 screen path with its
 *  parameters id-shaped (src/core/screens.ts), and `/conditions/{id}`, B-195's redirect address
 *  served as the shell until the redirect lands — and its two assets. The pages are one set of
 *  bytes and hold no data (R-BTN-57's one-time link is opened before any session exists); an
 *  unauthenticated browser gets the page all the same — the app itself says what it needs
 *  (`baton admin open`) and recovers when the session cookie lands — while every data call
 *  under `/v1/ui` keeps its principal and its refusal (R-BTN-16). */
function isShell(pathname: string): boolean {
  return pathname === '/' || pathname === '/login' || isScreenPath(pathname)
    || (pathname.startsWith('/conditions/') && ID_SEGMENT.test(pathname.slice('/conditions/'.length)));
}

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The dashboard's principals (R-BTN-57, R-BTN-16): Baton's own session cookie, which the core
 *  checks against its SQLite and BATON_ADMIN_KEYS on every request, and Cloudflare Access when
 *  the operator put it in front — verified here, and enough on its own only while no
 *  administrator key is configured (the core decides; round 1, 1-A-6). */
async function dashboardPrincipal(req: Request, env: Config, hasAdmin: () => Promise<boolean>): Promise<Record<string, string>> {
  const session = cookie(req, SESSION_COOKIE);
  if (req.headers.has('Cf-Access-Jwt-Assertion') && !(await hasAdmin())) {
    // A stale cookie must not mask legacy Access. The core checks the cookie first
    // and rechecks its own key configuration before accepting the Access principal.
    try {
      const owner = await verifyOwner(req, env);
      return session ? { 'X-Baton-Session': session, 'X-Baton-Owner': owner } : { 'X-Baton-Owner': owner };
    } catch (e) {
      if (!session) throw e;
      // A verifier failure must not veto a cookie the core can still authenticate.
    }
  }
  if (session) return { 'X-Baton-Session': session };
  throw new BatonError('unauthenticated', 'a dashboard session is required');
}

/** R-BTN-16, every session request: any request a dashboard session authorizes, reads
 *  included, carries an `Origin` equal to this Baton's when it carries one, and
 *  `Sec-Fetch-Site: same-origin` when it carries that header — else `forbidden`. */
function checkSessionRequest(req: Request, env: Config): void {
  const origin = req.headers.get('Origin');
  const site = req.headers.get('Sec-Fetch-Site');
  if ((origin != null && origin !== env.BATON_ORIGIN) || (site != null && site !== 'same-origin')) {
    throw new BatonError('forbidden', 'a dashboard session’s request comes from the dashboard’s own origin (R-BTN-16)');
  }
}

/** A signed request (R-BTN-13 as amended): a half-signed, malformed, foreign-@authority or
 *  mis-digested one stops here; the core checks the key, the signature, the clock (`created` is
 *  the core's: the one clock is its, R-BTN-32) and the nonce. */
async function forwardSigned(req: Request, env: Config, to: Forward): Promise<Response> {
  const signed = await verifyRequest(req, null, { origin: env.BATON_ORIGIN });
  return forward(withBody(req, signed.body), to, { 'X-Baton-Signed': signed.keyid });
}
const isSigned = (req: Request) => req.headers.has('Signature-Input') || req.headers.has('Signature');
/** A bearer that is an API key (R-BTN-159), else null; the core checks it against its public line. */
const apiKeyOf = (req: Request): string | null => {
  const h = req.headers.get('Authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return API_KEY.test(token) ? token : null;
};

/** The headers that carry a verified principal to the object. A request never brings its own. */
const PRINCIPAL_HEADERS = ['X-Baton-Credential', 'X-Baton-Owner', 'X-Baton-Sync', 'X-Baton-Signed', 'X-Baton-Webhook', 'X-Baton-Session', 'X-Baton-Api-Key', 'X-Baton-Access-Email'];

/** A route's answer, and the R-BTN-16 class its request is. `route` decides the class in the
 *  very branch that decides the route — beside the verification, for the answer and for that
 *  branch's refusal — so a route added below can never be missing from a second list of paths.
 *  `private`: a request a credential or a dashboard session authorizes, or an answer that
 *  hands out a cookie or carries a sign-in code; `public`: the dashboard's pages and files. */
type Answer = { res: Response; cache: 'public' | 'private' };

/** A branch's refusal: thrown like a `BatonError` (its `code` is one) and classed for the
 *  header. It wears its class as a plain own property, so it survives the `await`s between a
 *  branch and `front` without `instanceof` — a host's realm has `BatonError` classes of its own. */
function refuse(code: BatonError['code'], message: string, cache: Answer['cache'], extra: Record<string, unknown> = {}): BatonError {
  const e = new BatonError(code, message, extra);
  Object.defineProperty(e, 'cache', { value: cache, enumerable: true });
  return e;
}

/** The class `e` was thrown under, or `undefined` for one no branch classed (`internal`). */
function classOf(e: unknown): Answer['cache'] | undefined {
  const c = (e as { cache?: unknown } | null)?.cache;
  return c === 'public' || c === 'private' ? c : undefined;
}

/** The answer `run` gives — or gives by refusing — as the branch `cache` decides it. */
async function under(cache: Answer['cache'], run: () => Promise<Response> | Response): Promise<Answer> {
  try {
    return { res: await run(), cache };
  } catch (e) {
    // A verifier below throws a `BatonError` of the host's realm: its code is kept, the class
    // is the branch's.
    const b = e as Partial<BatonError> | null;
    if (classOf(e) !== undefined) throw e;
    if (b && typeof b.code === 'string' && typeof b.message === 'string') throw refuse(b.code, b.message, cache, b.extra);
    throw refuse('internal', 'internal error', cache);
  }
}

/** R-BTN-73 / R-BTN-95: a forge's notification is a trigger too, and its body is bounded as the
 *  App's is. The route's verification (a GitLab token, a Gitea or GitHub HMAC under the
 *  repository's own secret) is the core's, which B-169 does not build; until it does the route
 *  answers `not-found`, and a body over the cap is `too-large` before anything else is looked at. */
function forgeNotify(req: Request): Promise<Answer> {
  return under('private', async () => {
    if (req.method !== 'POST') throw new BatonError('not-found', 'no such route');
    await readCapped(req, MAX_DELIVERY, 'too-large');
    throw new BatonError('not-found', 'no such route: a forge’s notification is not verified yet');
  });
}

/** R-BTN-73: the GitHub App's delivery — the one route whose credential is GitHub's signature.
 *  Verified before anything is read; then only R-BTN-73's fields go on, in a request that
 *  carries nothing else of the delivery's. */
function delivery(req: Request, env: Config, to: Forward): Promise<Answer> {
  return under('private', async () => {
    if (req.method !== 'POST') throw new BatonError('not-found', 'no such route');
    const body = await verifyDelivery(req, env.BATON_GITHUB_WEBHOOK_SECRET);
    let payload: unknown = null;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      // A form-encoded or broken body is not a delivery Baton reads.
    }
    const d = pickDelivery(req.headers.get('X-GitHub-Event'), req.headers.get('X-GitHub-Delivery'), payload);
    if (!d) return new Response(null, { status: 204 });
    // A header carries bytes only: every character from U+007F up goes as a \u escape, which
    // the core's JSON.parse turns back into the same value (round 3, 3-A-0).
    const ascii = JSON.stringify(d).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return forward(new Request(req.url, { method: 'POST' }), to, { 'X-Baton-Webhook': ascii });
  });
}

async function route(req: Request, env: Config, to: Forward, hasAdmin: () => Promise<boolean>): Promise<Answer> {
  const { pathname } = new URL(req.url);
  if (pathname.startsWith('/v1/sync/')) {
    return under('private', async () => {
      // R-BTN-93: a sync key's signature is pre-checked here like every signed request, and its
      // key checked in the core; a CI identity token is verified here, and the core binds its
      // claims to one repository and role (Registry.forSync, forGitlab), so the front names no
      // repository.
      if (isSigned(req)) return forwardSigned(req, env, to);
      const claims = await verifySyncCredential(req, env);
      // A header carries bytes only: characters from U+007F up go as \u escapes (round 3, 3-A-1).
      const ascii = JSON.stringify(claims).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      return forward(req, to, { 'X-Baton-Sync': ascii });
    });
  }
  if (/^\/v1\/forges\/[^/]+\/notify$/.test(pathname)) return forgeNotify(req);
  if (pathname === '/v1/github/webhook') return delivery(req, env, to);
  if (pathname.startsWith('/v1/courier/')) {
    // R-BTN-80, R-BTN-103: a courier key or a machine key signs; the core checks which.
    return under('private', async () => {
      if (!isSigned(req)) throw new BatonError('unauthenticated', 'sign with a courier key or a machine key (R-BTN-13)');
      return forwardSigned(req, env, to);
    });
  }
  if (pathname.startsWith('/v1/forge-scope/')) {
    return under('private', async () => {
      if (req.method !== 'GET') throw new BatonError('not-found', 'no such route');
      if (!isSigned(req)) throw new BatonError('unauthenticated', 'a forge-scope read must be signed');
      return forwardSigned(req, env, to);
    });
  }
  if (pathname === '/v1/probe/readings') {
    // R-BTN-53, R-BTN-101: a probe key signs; the core checks it is one.
    return under('private', async () => {
      if (!isSigned(req)) throw new BatonError('unauthenticated', 'sign with a probe key (R-BTN-13)');
      return forwardSigned(req, env, to);
    });
  }
  if (pathname === '/v1/human-keys') {
    // R-BTN-185 (B-145): a human_only key's own route — registered human keys and the host's
    // BATON_HUMAN_KEYS lines sign; the core checks which.
    return under('private', async () => {
      if (req.method !== 'POST') throw new BatonError('not-found', 'no such route');
      if (!isSigned(req)) throw new BatonError('unauthenticated', 'sign with a human_only key (R-BTN-185)');
      return forwardSigned(req, env, to);
    });
  }
  // The repository reads (§11): a course's record, its blocks and a ticket's history — any key
  // granted on it; the blocks and the history also an owner's or an administrator's, whose keys
  // sign, as every key does. B-90: the board of one repository, read the same three ways — and
  // §12.8 (B-145): its policy read, for the same principals (R-BTN-189). R-BTN-181 (B-7's
  // slice): the attestation write signs the same way — the core checks the writer it names.
  // B-126 (R-BTN-194): a ticket itself, `GET …/tickets/{ticket}`, read like its blocks.
  // B-190 (R-BTN-84): one leg's runs, `GET …/legs/{leg}/runs`, read the same three ways — the
  // core refuses a runner's (§14: an owner's or an administrator's read).
  // B-176 (R-BTN-199): the sequence route, a write for the same principals — the core checks
  // each, and the repository's sync key beside them.
  // R-BTN-86 (§4.6, R3-1258): a ticket's children, open and closed, read like its blocks.
  // B-192: a read is the registry's (src/core/actions.ts) — no list of session paths lives
  // here. A GET whose entry lists `session` is the session's when the request carries the
  // session cookie and neither a signature nor an `Authorization` header: a signed request or
  // a bearer is that key's, and its cookie decides nothing. R-BTN-16's checks of every session
  // request apply. `/v1/ui/*` keeps its own branch below.
  const read = (req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/v1/ui/');
  if (read && sessionReadable(pathname) && !isSigned(req) && !req.headers.has('Authorization') && cookie(req, SESSION_COOKIE)) {
    return under('private', async () => {
      checkSessionRequest(req, env);
      return forward(req, to, { 'X-Baton-Session': cookie(req, SESSION_COOKIE)! });
    });
  }
  // …and a GET whose entry lists a key outside `/v1/admin/*` and `/v1/owner/*` is read as the
  // repository reads are, so a read added to the registry needs no path added here.
  const keyRead = read && !pathname.startsWith('/v1/admin/') && !pathname.startsWith('/v1/owner/') && (keyReadable(pathname) || sessionReadable(pathname));
  if (keyRead || pathname.startsWith('/v1/runner/') || /^\/v1\/repositories\/[^/]+\/(stats|blocked|board|policy|attestations|conditions|sequences\/[^/]+\/next|tickets\/[^/]+(\/(blocks|history|children|legs\/[^/]+\/runs))?)$/.test(pathname)) {
    return under('private', async () => {
      if (isSigned(req)) return forwardSigned(req, env, to);
      // R-BTN-159: a runner's (or, on the reads, an owner's or administrator's) API key.
      const apiKey = apiKeyOf(req);
      if (apiKey) return forward(req, to, { 'X-Baton-Api-Key': apiKey });
      // The transition (R3-1239): a bearer token still serves until every runner signs.
      const credential = await verifyRunner(req, env);
      return forward(req, to, { 'X-Baton-Credential': credential });
    });
  }
  if (pathname.startsWith('/v1/admin/') || pathname.startsWith('/v1/owner/')) {
    // R-BTN-57, R-BTN-58: an administrator's or an owner's key signs every request, or — an API
    // key (R-BTN-159) — comes as a bearer; the core checks which, and for which repository.
    return under('private', async () => {
      if (isSigned(req)) return forwardSigned(req, env, to);
      const apiKey = apiKeyOf(req);
      if (!apiKey) throw new BatonError('unauthenticated', 'sign with an administrator or owner key, or send its API key as a bearer (R-BTN-13, R-BTN-159)');
      return forward(req, to, { 'X-Baton-Api-Key': apiKey });
    });
  }
  if (pathname === '/v1/login') {
    // R-BTN-16: against login CSRF, both flows come as JSON from this Baton's own page; the
    // answer hands out the session cookie, so it is withheld whatever it says.
    return under('private', async () => {
      if (req.method !== 'POST') throw new BatonError('not-found', 'no such route');
      checkStateChanging(req, env);
      const bytes = await readCapped(req, 4096);
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new BatonError('invalid-params', 'the body is not JSON');
      }
      const login = checkLogin(body);
      if ('access' in login) {
        const access = await verifyAccess(req, env);
        if ('reason' in access) throw new BatonError('unauthenticated', 'no verified Cloudflare Access email', { reason: access.reason });
        return forward(withBody(req, bytes), to, { 'X-Baton-Access-Email': access.email });
      }
      return forward(withBody(req, bytes), to, {});
    });
  }
  const located = await conditionRedirect(req, env, to, pathname);
  if (located) return located;
  if (ASSETS[pathname] || isShell(pathname)) return { res: serve(pathname, req), cache: 'public' };
  // A session's own routes — `/v1/ui/*` — until B-203 retires them with V1's state read: the
  // principal decides whether even the not-found is named (the dashboard's own pages are in the
  // public branch, above).
  if (pathname.startsWith('/v1/ui/')) {
    return under('private', async () => {
      const principal = await dashboardPrincipal(req, env, hasAdmin);
      checkSessionRequest(req, env);
      if (req.method !== 'GET' && req.method !== 'HEAD') checkStateChanging(req, env);
      return forward(req, to, principal);
    });
  }
  throw refuse('not-found', 'no such route', 'public');
}

/** B-195 (R-BTN-163): `GET /conditions/{id}`, the address a notification carries. With a session
 *  whose repositories hold the id, a `302` to the condition's Resolve page in the tree; in every
 *  other case null, and the shell is served — the same bytes anyone gets — which draws sign-in
 *  or "No such condition". The lookup is the core's `condition.locate`, asked as the session
 *  (its repositories only) under R-BTN-16's checks of a session request: a request that fails
 *  them, carries no cookie, or names an id the session does not hold reveals nothing. */
async function conditionRedirect(req: Request, env: Config, to: Forward, pathname: string): Promise<Answer | null> {
  const id = pathname.startsWith('/conditions/') ? pathname.slice('/conditions/'.length) : '';
  const session = cookie(req, SESSION_COOKIE);
  if (req.method !== 'GET' || !session || !ID_SEGMENT.test(id)) return null;
  try {
    checkSessionRequest(req, env);
  } catch {
    return null;
  }
  const lookup = new Request(new URL(`/v1/conditions/${encodeURIComponent(id)}`, req.url), { method: 'GET' });
  const res = await forward(lookup, to, { 'X-Baton-Session': session }).catch(() => null);
  if (!res) return null;
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const path = ((await res.json().catch(() => null)) as { path?: unknown } | null)?.path;
  if (typeof path !== 'string' || !isScreenPath(path)) return null;
  return { res: new Response(null, { status: 302, headers: { Location: path } }), cache: 'private' };
}

function serve(pathname: string, req: Request): Response {
  const file = ASSETS[pathname] ?? (isShell(pathname) ? PAGE : undefined);
  if (!file || req.method !== 'GET') throw new BatonError('not-found', 'no such page');
  return new Response(file[0], { headers: { 'Content-Type': file[1], 'Cache-Control': NO_STORE } });
}

/** The one core (§3): every request reaches it carrying only the principal the front verified. */
function forward(req: Request, to: Forward, principal: Record<string, string>): Promise<Response> {
  const headers = new Headers(req.headers);
  for (const h of PRINCIPAL_HEADERS) headers.delete(h);
  headers.delete('Cf-Access-Jwt-Assertion');
  for (const [k, v] of Object.entries(principal)) headers.set(k, v);
  return to(new Request(req, { headers }));
}

/** The `recommended` the core last stated on an answer that passed through here (R-BTN-197,
 *  B-254). The front reads nothing of the store — on the Worker the instance's settings live in
 *  the object, a subrequest away — so it learns the instance's raised `recommended` from the
 *  core's own answers, which read it, and states what it learned on the responses it builds
 *  itself: the `client-too-old` refusal and its own refusals, front-level answers an old client
 *  or a stranger reads. Until the first answer teaches it, the code's own default — the raise
 *  reaches every isolate with the first request it forwards. `min` it never learns: the floor
 *  is the code's constant (the env's own word under the test bindings), never the store's. */
const learnedRecommended = new WeakMap<Config, string>();

function frontVersions(env: Config) {
  const floor = servedClientVersions(env);
  return { min: floor.min, recommended: maxVersion(learnedRecommended.get(env) ?? floor.recommended, floor.min) };
}

/** Finish an answer without consulting the core, including a refusal before routing. */
export function frontResponse(pathname: string, env: Config, res: Response): Response {
  if (pathname.startsWith('/v1/')) res = withClientVersions(res, frontVersions(env));
  return withSecurityHeaders(res);
}

/** A request from outside, answered: both hosts' entry point. Every answer leaves with the
 *  security headers and, when its route decided so, `Cache-Control: no-store` (R-BTN-16). */
export async function front(req: Request, env: Config, to: Forward, hasAdmin: () => Promise<boolean> = async () => false): Promise<Response> {
  let res: Response;
  let cache: Answer['cache'] = 'public';
  // R-BTN-197: the one check that comes before every other — the client's own statement of its
  // version, read before the request's signature is checked and before anything of it is read or
  // written, so an old client gets this one answer and never a failure of a request shape it no
  // longer matches. A request without the header compares as `0.0.0`. The floor is the code's
  // constant (a test binding raises it for the suite, §13a); `recommended` is what the front has
  // learned of the instance's raise, the code's default until an answer teaches it, never below
  // the floor.
  const { pathname } = new URL(req.url);
  const api = pathname.startsWith('/v1/');
  if (api) {
    const served = frontVersions(env);
    const client = clientVersionOf(req.headers.get(CLIENT_HEADER)) ?? '0.0.0';
    if (compareVersions(client, served.min) < 0) {
      if (req.body && !req.bodyUsed) req.body.cancel().catch(() => {});
      const e = clientTooOld(client, served.min, served.recommended);
      return frontResponse(pathname, env, noStore(errorResponse(e.code, e.message, e.extra)));
    }
  }
  try {
    ({ res, cache } = await route(req, env, to, hasAdmin));
  } catch (e) {
    // A refused request's body is never read; release it so the runtime does not.
    if (req.body && !req.bodyUsed) req.body.cancel().catch(() => {});
    cache = classOf(e) ?? 'public';
    res = e instanceof BatonError ? errorResponse(e.code, e.message, e.extra) : errorResponse('internal', 'internal error');
  }
  // R-BTN-197: every response under /v1 carries the versions Baton serves, a refusal included.
  // A forwarded answer carries the core's own — which read the instance's raised `recommended`
  // — and teaches this front its value; what the front built itself is filled, set-if-absent,
  // from what it serves.
  if (api) {
    const stated = parseClientVersions(res.headers.get(VERSIONS_HEADER));
    if (stated) learnedRecommended.set(env, stated.recommended);
  }
  return frontResponse(pathname, env, cache === 'private' ? noStore(res) : res);
}
