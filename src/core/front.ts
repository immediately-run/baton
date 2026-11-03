// front.ts — what stands in front of Baton's core (BATON_SPEC §3, §10): it verifies the
// principal for the path, applies the R-BTN-16 rules, serves the dashboard's static files, and
// forwards the API to the core — through the Durable Object on Cloudflare, through the request
// queue locally (R-BTN-55). Every response leaves with the security headers.
import { API_KEY, verifyOwner, verifyRequest, verifySyncCredential, verifyWorker, checkStateChanging, withBody } from './auth';
import { BatonError, SESSION_COOKIE, errorResponse, withSecurityHeaders } from './http';
import { pickDelivery, verifyDelivery } from './webhook';
import type { Config } from './ports';
import page from '../ui/index.html';
import style from '../ui/app.css';
import script from '../ui/app.js';

/** How the front reaches the one core (§3): the request carries only the principal headers
 *  the front set. */
export type Forward = (req: Request) => Promise<Response>;

const STATIC: Record<string, [string, string]> = {
  '/': [page, 'text/html; charset=utf-8'],
  '/login': [page, 'text/html; charset=utf-8'],
  '/ui/app.css': [style, 'text/css; charset=utf-8'],
  '/ui/app.js': [script, 'text/javascript; charset=utf-8'],
};
/** What anyone may fetch: the dashboard and login pages and the code they run. The two pages
 *  are the same bytes and hold no data (R-BTN-57's one-time link is opened before any session
 *  exists); an unauthenticated browser gets the page all the same — the app itself says what
 *  it needs (`baton admin open`) and recovers when the session cookie lands — while every
 *  data call under `/v1/ui` keeps its principal and its refusal (R-BTN-16). */
const PUBLIC = new Set(['/', '/login', '/ui/app.css', '/ui/app.js']);

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
async function dashboardPrincipal(req: Request, env: Config): Promise<Record<string, string>> {
  // A session is Baton's own principal: Access in front of it is the operator's hardening, never
  // a second check Baton's settings could fail (R-BTN-16; round 3, 3-A-0).
  // Beside a session, an assertion Baton's settings refuse is simply no Access principal.
  const session = cookie(req, SESSION_COOKIE);
  const out: Record<string, string> = {};
  if (req.headers.has('Cf-Access-Jwt-Assertion')) {
    if (!session) out['X-Baton-Owner'] = await verifyOwner(req, env);
    else {
      const owner = await verifyOwner(req, env).catch(() => null);
      if (owner) out['X-Baton-Owner'] = owner;
    }
  }
  if (session) out['X-Baton-Session'] = session;
  if (!Object.keys(out).length) throw new BatonError('unauthenticated', 'a dashboard session is required: `baton admin open` mints a link');
  return out;
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
const PRINCIPAL_HEADERS = ['X-Baton-Credential', 'X-Baton-Owner', 'X-Baton-Sync', 'X-Baton-Signed', 'X-Baton-Webhook', 'X-Baton-Session', 'X-Baton-Api-Key'];

async function route(req: Request, env: Config, to: Forward): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname.startsWith('/v1/sync/')) {
    // R-BTN-93: a sync key's signature is pre-checked here like every signed request, and its key
    // checked in the core; a CI identity token is verified here, and the core binds its claims to
    // one repository and role (Registry.forSync, forGitlab), so the front names no repository.
    if (isSigned(req)) return forwardSigned(req, env, to);
    const claims = await verifySyncCredential(req, env);
    // A header carries bytes only: characters from U+007F up go as \u escapes (round 3, 3-A-1).
    const ascii = JSON.stringify(claims).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return forward(req, to, { 'X-Baton-Sync': ascii });
  }
  if (pathname === '/v1/github/webhook') {
    // R-BTN-73: the GitHub App's delivery — the one route whose credential is GitHub's
    // signature. Verified before anything is read; then only R-BTN-73's fields go on, in a
    // request that carries nothing else of the delivery's.
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
  }
  if (pathname.startsWith('/v1/courier/')) {
    // R-BTN-80, R-BTN-103: a courier key or a machine key signs; the core checks which.
    if (!isSigned(req)) throw new BatonError('unauthenticated', 'sign with a courier key or a machine key (R-BTN-13)');
    return forwardSigned(req, env, to);
  }
  if (pathname === '/v1/probe/readings') {
    // R-BTN-53, R-BTN-101: a probe key signs; the core checks it is one.
    if (!isSigned(req)) throw new BatonError('unauthenticated', 'sign with a probe key (R-BTN-13)');
    return forwardSigned(req, env, to);
  }
  if (pathname === '/v1/human-keys') {
    // R-BTN-185 (B-145): a human_only key's own route — registered human keys and the host's
    // BATON_HUMAN_KEYS lines sign; the core checks which.
    if (req.method !== 'POST') throw new BatonError('not-found', 'no such route');
    if (!isSigned(req)) throw new BatonError('unauthenticated', 'sign with a human_only key (R-BTN-185)');
    return forwardSigned(req, env, to);
  }
  // The repository reads (§11): a course's record, its blocks and a ticket's history — any key
  // granted on it; the blocks and the history also an owner's or an administrator's, whose keys
  // sign, as every key does. B-90: the board of one repository, read the same three ways — and
  // §12.8 (B-145): its signed policy read, for the same principals (R-BTN-189).
  if (pathname.startsWith('/v1/runner/') || /^\/v1\/repositories\/[^/]+\/(stats|blocked|board|policy|tickets\/[^/]+\/(blocks|history))$/.test(pathname)) {
    if (isSigned(req)) return forwardSigned(req, env, to);
    // R-BTN-159: a worker's (or, on the reads, an owner's or administrator's) API key.
    const apiKey = apiKeyOf(req);
    if (apiKey) return forward(req, to, { 'X-Baton-Api-Key': apiKey });
    // The transition (R3-1239): a bearer token still serves until every worker signs.
    const credential = await verifyWorker(req, env);
    return forward(req, to, { 'X-Baton-Credential': credential });
  }
  if (pathname.startsWith('/v1/admin/') || pathname.startsWith('/v1/owner/')) {
    // R-BTN-57, R-BTN-58: an administrator's or an owner's key signs every request, or — an API
    // key (R-BTN-159) — comes as a bearer; the core checks which, and for which repository.
    if (isSigned(req)) return forwardSigned(req, env, to);
    const apiKey = apiKeyOf(req);
    if (!apiKey) throw new BatonError('unauthenticated', 'sign with an administrator or owner key, or send its API key as a bearer (R-BTN-13, R-BTN-159)');
    return forward(req, to, { 'X-Baton-Api-Key': apiKey });
  }
  if (pathname === '/v1/login') {
    // R-BTN-16: against login CSRF, the token comes as JSON from this Baton's own page.
    if (req.method !== 'POST') throw new BatonError('not-found', 'no such route');
    checkStateChanging(req, env);
    return forward(req, to, {});
  }
  if (pathname === '/' || pathname.startsWith('/ui/') || pathname.startsWith('/v1/ui/') || PUBLIC.has(pathname)) {
    if (PUBLIC.has(pathname)) return serve(pathname, req);
    const principal = await dashboardPrincipal(req, env);
    if (pathname.startsWith('/v1/ui/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') checkStateChanging(req, env);
      return forward(req, to, principal);
    }
    // An exotic /ui/ path that is not one of the public files: the principal decides whether
    // even the not-found is named (the dashboard pages themselves are in PUBLIC, above).
    const ok = await forward(new Request(new URL('/v1/ui/session', req.url)), to, principal);
    if (!ok.ok) return ok;
    return serve(pathname, req);
  }
  throw new BatonError('not-found', 'no such route');
}

function serve(pathname: string, req: Request): Response {
  const file = STATIC[pathname];
  if (!file || req.method !== 'GET') throw new BatonError('not-found', 'no such page');
  return new Response(file[0], { headers: { 'Content-Type': file[1], 'Cache-Control': 'no-store' } });
}

/** The one core (§3): every request reaches it carrying only the principal the front verified. */
function forward(req: Request, to: Forward, principal: Record<string, string>): Promise<Response> {
  const headers = new Headers(req.headers);
  for (const h of PRINCIPAL_HEADERS) headers.delete(h);
  for (const [k, v] of Object.entries(principal)) headers.set(k, v);
  return to(new Request(req, { headers }));
}

/** A request from outside, answered: both hosts' entry point. */
export async function front(req: Request, env: Config, to: Forward): Promise<Response> {
  try {
    return withSecurityHeaders(await route(req, env, to));
  } catch (e) {
    // A refused request's body is never read; release it so the runtime does not.
    if (req.body && !req.bodyUsed) req.body.cancel().catch(() => {});
    if (e instanceof BatonError) return withSecurityHeaders(errorResponse(e.code, e.message, e.extra));
    return withSecurityHeaders(errorResponse('internal', 'internal error'));
  }
}
