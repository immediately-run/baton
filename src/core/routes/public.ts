import type { BatonCore } from '../baton';
import { BatonError, CLIENT_HEADER, json, readJson } from '../http';
import { SESSION_COOKIE, SESSION_MS } from '../admin';
import { clientVersionOf } from '../../shared/versions.mjs';
import { checkBlockedOn, checkSequenceTake, COURSE_ID, SEQUENCE_KIND, TICKET_ID, repositoryOf } from '../validate';
import { HISTORY_PAGE_MAX } from '../history';
import { boardView } from '../views';
import type { ReadPrincipal } from '../reads/kit';
import { liveRepoParam, pathSegment, requireGrant, runnerSecret, ticketOf } from './kit';
import { authenticated } from './principal';

export async function publicRoute(core: Pick<BatonCore, 'admin'>, req: Request, url: URL, principal: { accessEmail: string | null }): Promise<Response | null> {
  if (req.method === 'POST' && url.pathname === '/v1/login') {
    // R-BTN-155, R-BTN-16: exchange a link token or verified Access email for the session cookie — `__Host-`,
    // host-only, Secure, HttpOnly, SameSite=Strict, at most 12 hours.
    const value = await core.admin.login(await readJson(req), principal.accessEmail);
    const res = json({ ok: true });
    res.headers.set('Set-Cookie', `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`);
    return res;
  }
  return null;
}

/**
 * `POST /v1/repositories/{repository}/sequences/{kind}/next` (§4.3, B-176, R-BTN-199): the
 * next number of a repository's sequence, for the principals that file tickets today — a key
 * granted on the repository (the runner role), an owner of it, an administrator, the
 * repository's sync key, and a delegated key (a number is not authority, and issuing one more
 * than needed only leaves a gap). The caller's `floor` seeds and guards the sequence; `for` is
 * recorded, never trusted.
 */
export async function sequenceRoute(core: Parameters<typeof authenticated>[0] & Pick<BatonCore, 'registry' | 'admin' | 'store' | 'sequences'>, req: Request, url: URL): Promise<Response | null> {
  const m = /^\/v1\/repositories\/([^/]+)\/sequences\/([^/]+)\/next$/.exec(url.pathname);
  if (!m || req.method !== 'POST') return null;
  const seg = pathSegment;
  const { id: repo } = liveRepoParam(core.registry, seg(m[1]));
  const kind = seg(m[2]);
  if (!SEQUENCE_KIND.test(kind)) throw new BatonError('invalid-params', 'kind: must match ' + SEQUENCE_KIND);
  // The same principals the repository's reads take (blocksRoute), with the repository's sync
  // key beside them: a sync credential files tickets too, and its key is never a runner's.
  // A runner's key on EITHER path — signed, an API key, or the transition's bearer token
  // (front.ts's verifyRunner) — takes numbers only where R-BTN-58's grant binds it, exactly as
  // blocksRoute checks the same path (review round 1, finding 1: the bearer once skipped it).
  let cred = req.headers.get('X-Baton-Credential');
  let actor = `runner:${cred ?? ''}`;
  let runnerKey = true;
  if (req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key')) {
    const admins = await core.admin.adminFingerprints();
    // The signed request's body is put back by the verifier: read it from the returned request.
    const v = await authenticated(core, req, (fp) => admins.get(fp) ?? core.admin.ownerKey(fp) ?? core.registry.syncKey(fp)?.public_key ?? core.runners.publicKey(fp));
    req = v.req;
    cred = v.cred;
    const sync = core.registry.syncKey(cred);
    if (admins.has(cred)) { actor = `admin:${cred}`; runnerKey = false; }
    else if (core.admin.ownerKey(cred)) {
      if (!core.admin.owns(cred, repo)) throw new BatonError('forbidden', `this key does not own ${repo}`);
      actor = `owner:${cred}`;
      runnerKey = false;
    } else if (sync?.role === 'sync' && sync.repository === repo) { actor = 'sync'; runnerKey = false; }
    else if (sync?.role === 'sync') throw new BatonError('forbidden', `this sync key serves ${sync.repository}, not ${repo}`);
    else if (sync) throw new BatonError('forbidden', `this key is ${sync.repository}'s ${sync.role} key, not ${repo}'s sync key`);
    else actor = `runner:${cred}`;
  }
  if (!cred) throw new BatonError('unauthenticated', 'no principal');
  if (runnerKey) requireGrant(core.store, cred, repo);
  // An empty body legitimately carries neither field; a body that is not JSON is the caller's
  // error, never "no floor, no for" (review round 1, nit 2).
  const rawBody = await req.text();
  let body: unknown = null;
  if (rawBody.trim() !== '') {
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new BatonError('invalid-params', 'the body is not JSON: an empty body carries no floor and no for');
    }
  }
  const take = checkSequenceTake(body);
  return json(core.sequences.next(repo, kind, take.floor, actor, take.forTicket));
}

/**
 * `GET /v1/repositories/{repository}/tickets/{ticket}/blocks[?runner=me]` and
 * `GET /v1/repositories/{repository}/blocked[?on=…&transitive=1 | ?cursor=…]` (R-BTN-75, §11):
 * for any key granted on the repository, an owner of it, or an administrator. `runner=me` is a
 * runner session's own answer, so it needs the session's secret. B-192: served through
 * src/core/reads/repository.ts, for a session beside those keys.
 */
export async function repositoryRead(core: Parameters<typeof boardView>[0] & Pick<BatonCore, 'policies' | 'instance' | 'blocks' | 'history'>, req: Request, url: URL, repo: string, who: ReadPrincipal): Promise<Response | null> {
  const blocks = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/blocks$/.exec(url.pathname);
  const blocked = /^\/v1\/repositories\/([^/]+)\/blocked$/.exec(url.pathname);
  // R-BTN-81: a ticket's history, read by the principals that may read its blocks (§11).
  const history = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/history$/.exec(url.pathname);
  // B-190 (R-BTN-84, §14): one leg's runs of a ticket, with the inputs replay reads — an
  // owner's or an administrator's read (§11's command tree), never a runner's.
  const runs = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/legs\/([^/]+)\/runs$/.exec(url.pathname);
  // R-BTN-194 (B-126): the ticket itself — its filter fields, where it is, who last pushed it
  // and its brief mark — for the same principals; `baton ticket show` prints the provenance first.
  const show = !blocks && !history && !runs ? /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)$/.exec(url.pathname) : null;
  // R-BTN-86 (§4.6, R3-1258): a ticket's children, open and closed, with station and blocked
  // state — the same principals that read its blocks.
  const children = /^\/v1\/repositories\/([^/]+)\/tickets\/([^/]+)\/children$/.exec(url.pathname);
  // B-90: the dashboard's view of one repository, for the same principals — an administrator
  // sees any, an owner its own, a granted key the repositories it is granted on.
  const boardRead = /^\/v1\/repositories\/([^/]+)\/board$/.exec(url.pathname);
  // §12.8 (B-145, R-BTN-189): the policy read, for the same principals.
  const policy = /^\/v1\/repositories\/([^/]+)\/policy$/.exec(url.pathname);
  if (!blocks && !blocked && !history && !show && !boardRead && !policy && !runs && !children) return null;
  const seg = pathSegment;
  // B-192: the caller is resolved and authorized before this is reached (src/core/reads/) —
  // `repo` is live and the principal's to read; a session reads as its role's key does, with
  // no grant of its own and no runner's secret.
  const role: 'admin' | 'owner' | 'runner' = who.kind === 'session' ? (who.role === 'administrator' ? 'admin' : 'owner') : who.role;
  const cred = who.kind === 'session' ? who.id : who.cred;
  // B-190 (§14): a leg's runs are what replay reads — an owner's or an administrator's read.
  if (runs && role === 'runner') throw new BatonError('forbidden', `a leg's runs are an owner's or an administrator's read, not a runner's (R-BTN-84)`);
  // R-BTN-179 (B-90): a granted key's board names its grant on THIS repository — the same grant the
  // heartbeat's answer names for it (runnerApi.grantedCapabilities), 'none' left out — and
  // null for a key no grant binds there (a bearer's or a seed key's reach is its own).
  let granted: string[] | null = null;
  if (role === 'runner') {
    const c = core.runners.credential(cred);
    granted = c.granted
      ? [...new Set(core.runners.grantedCapabilities(cred, repo))].filter((x) => x !== 'none').sort()
      : null;
  }
  if (boardRead) return json(boardView(core, repo, granted));
  if (policy) return policyRead(core, repo);
  if (show) {
    const id = ticketOf(repo, show[2]);
    const out = core.claims.ticketView(id);
    if (!out) throw new BatonError('not-found', `${id} is not on the board`);
    return json(out);
  }
  // R-BTN-86 (§4.6, R3-1258): the children of a ticket, open and closed — each open one's
  // station and whether a block holds it, each closed one's closure. An open child blocks
  // its parent only through a call (B-62): nothing here computes one.
  if (children) {
    const id = ticketOf(repo, children[2]);
    const open = core.sql<{ id: string; station: string | null }>(
      `SELECT t.id, s.station FROM tickets t LEFT JOIN ticket_stations s ON s.ticket_id = t.id
       WHERE t.repository_id = ? AND t.parent = ? ORDER BY t.id`, repo, id);
    const blockedSet = new Set(core.sql<{ ticket_id: string }>(
      `SELECT DISTINCT ticket_id FROM ticket_blocks WHERE ticket_id >= ? || ':' AND ticket_id < ? || ';'`, repo, repo).map((x) => x.ticket_id));
    const closed = core.sql<{ ticket_id: string; closed_as: string; closed_at: number }>(
      `SELECT ticket_id, closed_as, closed_at FROM closed_tickets
       WHERE ticket_id >= ? || ':' AND ticket_id < ? || ';' AND parent = ? ORDER BY ticket_id`, repo, repo, id);
    return json({
      children: [
        ...open.map((c) => ({ ticket_id: c.id, station: c.station, blocked: blockedSet.has(c.id) })),
        ...closed.map((c) => ({ ticket_id: c.ticket_id, station: null, blocked: false, closed: { as: c.closed_as, closed_at: c.closed_at } })),
      ],
    });
  }
  if (history) {
    const id = ticketOf(repo, history[2]);
    const before = url.searchParams.get('before');
    const limit = url.searchParams.get('limit');
    const b = before == null ? null : Number(before);
    const n = limit == null ? 50 : Number(limit);
    if (b != null && !(Number.isInteger(b) && b > 0)) throw new BatonError('invalid-params', 'before: must be the next_before a page gave');
    if (!(Number.isInteger(n) && n >= 1 && n <= HISTORY_PAGE_MAX)) throw new BatonError('invalid-params', `limit: must be an integer from 1 to ${HISTORY_PAGE_MAX}`);
    // B-129: the ended claims' branches and PRs ride with the path (R-BTN-24's records,
    // pruned) — the PR a ticket's frontmatter lost, so a claimant continues the change.
    return json({ ...core.history.list(id, b, n), resume: core.claims.resumeOf(id) });
  }
  if (runs) {
    const id = ticketOf(repo, runs[2]);
    const leg = seg(runs[3]);
    if (!COURSE_ID.test(leg)) throw new BatonError('invalid-params', 'leg: must be a leg id');
    return json(core.claims.runsOf(id, leg));
  }
  if (blocks) {
    const id = ticketOf(repo, blocks[2]);
    let runner: number | null = null;
    const currentWho = url.searchParams.get('runner');
    const legacyWho = url.searchParams.get('worker');
    if (currentWho != null && legacyWho != null && currentWho !== legacyWho) throw new BatonError('invalid-params', 'runner and worker differ');
    const who = currentWho ?? legacyWho;
    if (who != null) {
      if (who !== 'me' || role !== 'runner') throw new BatonError('invalid-params', 'runner: only `me`, from a runner session');
      const { secret, legacyName } = runnerSecret(req);
      runner = await core.runners.authRunner(cred, secret, clientVersionOf(req.headers.get(CLIENT_HEADER)), legacyWho != null || legacyName);
    }
    return json(core.blocks.blocksOf(id, runner));
  }
  const on = url.searchParams.get('on');
  if (on == null) {
    const cursor = url.searchParams.get('cursor');
    if (cursor != null && !(TICKET_ID.test(cursor) && repositoryOf(cursor) === repo)) throw new BatonError('invalid-params', 'cursor: must be the next_cursor a page gave');
    return json(core.blocks.blockedAll(repo, cursor));
  }
  const t = url.searchParams.get('transitive');
  if (t != null && t !== '1' && t !== '0') throw new BatonError('invalid-params', 'transitive: must be 1 or 0');
  return json(core.blocks.blockedOn(repo, checkBlockedOn(on), t === '1'));
}

/** The versioned policy and its current guarantees (R-BTN-189). */
function policyRead(core: Pick<BatonCore, 'policies' | 'now' | 'instance'>, repository: string): Response {
  const cur = core.policies.current(repository);
  if (!cur) throw new BatonError('not-found', `${repository} has no policy yet`);
  const at = core.now();
  return json({
    repository,
    version: cur.version,
    hash: cur.hash,
    policy: cur.policy,
    guarantees: core.policies.guaranteesFor(repository),
    floors: core.policies.floors(repository),
    check_app_id: core.instance.checkAppId(),
    at,
    // CLI 0.1.3 and 0.1.4 format this unconditionally in `owner policy show`.
    // Use the read time, not a future expiry: this response is unsigned.
    valid_until: at,
  });
}
