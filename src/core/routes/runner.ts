import type { ClaimAnswer } from '../../shared/runner-wire';
import type { BatonCore } from '../baton';
import { BatonError, CLIENT_HEADER, json, readJson } from '../http';
import { clientVersionOf } from '../../shared/versions.mjs';
import { CAPABILITY_NAME, checkNoticeClaim, checkRepositoryId, GIT_BRANCH, GIT_REPO } from '../validate';
import { repositoryOf } from '../registry';
import { requireFleetScope, runnerViewResponse } from '../runnerViews';
import type { Courier } from '../notices';
import { authenticated, verifySigned } from './principal';
import { holderTicket, liveRepoParam, requireGrant, runnerSecret } from './kit';
import { noteIdle, type IdleDetail } from '../idleReasons';
import { parseAdminKeys, parseSshKey } from '../auth';
import { forgeScope } from '../forgeScope';
import { requireRunnerKeyPolicy, runnerKeyAllowed } from '../runnerKeyPolicy';
import { sha256Hex } from '../runnerApi';

type RunnerAuthCore = Parameters<typeof authenticated>[0] & Pick<BatonCore, 'admin'>;
type RunnerCore = Pick<BatonCore, 'store' | 'registry' | 'runners' | 'claims' | 'sql' | 'admin' | 'now' | 'queues' | 'resources' | 'cutover' | 'conditions' | 'blocks' | 'config'>;

export async function runnerPrincipal(core: RunnerAuthCore, req: Request) {
  let cred = req.headers.get('X-Baton-Credential');
  const { secret, legacyName } = runnerSecret(req);
  if (req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key')) {
    // R-BTN-13 as amended: the front checked the request's shape, @authority and digest; the
    // key, the signature and the clock are checked here, and the nonce in this turn. An API
    // key (R-BTN-159) is checked against the public line its grant registered.
    ({ req, cred } = await authenticated(core, req));
    // One role per key (R-BTN-57): a key in BATON_ADMIN_KEYS is never a runner's, even one
    // granted before it was listed.
    if ((await core.admin.adminFingerprints()).has(cred)) throw new BatonError('forbidden', 'an administrator key is never a runner key (R-BTN-57)');
  }
  return { req, cred, secret, legacyName };
}

type RunnerPrincipal = Omit<Awaited<ReturnType<typeof runnerPrincipal>>, 'req'>;

export async function runnerRoute(core: RunnerCore, req: Request, url: URL, principal: RunnerPrincipal): Promise<Response | null> {
  const p = url.pathname;
  const m = req.method;
  const { cred, secret, legacyName } = principal;
  const tx = <T>(f: () => T): T => core.store.transaction(f);
  // The stats and conditions list (§14) are served by reads/repository.ts (B-192).
  if (p.startsWith('/v1/runner/')) {
    if (!cred) throw new BatonError('unauthenticated', 'no runner principal');
    // R-BTN-197: every runner call records its Baton-Client as the runner's own statement of
    // its version (§13.3), with the heartbeat and with the secret-authenticated calls alike.
    const client = clientVersionOf(req.headers.get(CLIENT_HEADER));
    if (m === 'POST' && p === '/v1/runner/heartbeat') {
      const body = await readJson(req);
      // The hashing is async; the writes happen in one transaction after it (§3: atomic).
      return json(await core.runners.heartbeat(cred, secret, body, client, legacyName));
    }
    const view = p.slice('/v1/runner/'.length);
    if (m === 'GET' && (view === 'fleet' || view === 'instances' || view === 'launch-candidates')) {
      const credential = core.runners.credential(cred);
      if (credential.kind !== 'runner' || !(req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key'))) throw new BatonError('forbidden', 'the view requires a machine key');
      const scope = core.claims.viewScope(cred);
      const repository = view === 'fleet' ? checkRepositoryId(url.searchParams.get('repository')) : null;
      if (repository) requireFleetScope(repository, scope);
      return runnerViewResponse(core.store, core.now(), req, scope, view, repository, () =>
        repository ? core.claims.fleetView(repository, scope, core.queues.all(repository))
          : view === 'instances' ? core.claims.instanceView(scope, core.resources) : core.claims.launchCandidates(scope));
    }
    if (m === 'GET' && p === '/v1/runner/mode') {
      await core.runners.authRunner(cred, secret, client, legacyName);
      // §11: `?repository=` — each repository cuts over on its own (R-BTN-28). R-BTN-47
      // (B-173): a retired one is as one never registered.
      const { id: repo } = liveRepoParam(core.registry, url.searchParams.get('repository'), () => ['invalid-params', 'repository: must be a registered repository id']);
      requireRegistrationScope(core, cred, [repo]);
      return json(core.runners.mode(repo));
    }
    if (m === 'GET' && p === '/v1/runner/branch-holder') {
      // §6.3: a push to an item branch asks who holds the tickets it maps to; machine key alone,
      // or with a secret so the caller's own claim is not "another".
      // A pre-push hook has git's spellings: refs/heads/<branch> and owner/name.git.
      const gitRepo = (url.searchParams.get('repo') ?? '').replace(/\.git$/, '');
      const branch = (url.searchParams.get('branch') ?? '').replace(/^refs\/heads\//, '');
      if (!GIT_REPO.test(gitRepo)) throw new BatonError('invalid-params', 'repo: must be owner/name');
      if (!GIT_BRANCH.test(branch)) throw new BatonError('invalid-params', 'branch: must be a branch name');
      const caller = secret ? await core.runners.authRunner(cred, secret, client, legacyName) : null;
      const result = core.claims.branchHolder(caller, gitRepo, branch);
      requireRegistrationScope(core, cred, result.tickets.map(repositoryOf));
      return json(result);
    }
    const holder = /^\/v1\/runner\/tickets\/([^/]+)\/holder$/.exec(p);
    if (m === 'GET' && holder) {
      // R-BTN-7: callable with the token alone (the witness has no sidecar); with a secret, the
      // caller's own claim is not "another".
      const item = holderTicket(core.registry, holder[1]);
      requireRegistrationScope(core, cred, [repositoryOf(item)]);
      const caller = secret ? await core.runners.authRunner(cred, secret, client, legacyName) : null;
      return json(core.claims.holder(caller, item));
    }
    const runnerId = await core.runners.authRunner(cred, secret, client, legacyName);
    if (m === 'POST' && p === '/v1/runner/claim') {
      const body = await readJson(req);
      // B-127 (round 2, the pairing): the claim and the standing signed-control record are
      // read in ONE transaction, and the record it paired with is stored on the claim — the
      // answer serves the claim's own record, and a lost-response replay of the same
      // request_id serves the same pairing again, whatever the board has moved to since.
      // The old code read the record after the claim's transaction (an async hop away, for
      // the owner keys), so a post accepted in between paired the claim's snapshot with the
      // newer post's record, and the runner's own checks (a keyless read must be the
      // snapshot itself; a signed read must be its ancestor) burned the honest claim as
      // `cannot-finish:spec`, a counted, non-retryable attempt, where the stale board's
      // release is unpenalised.
      const answer = claimWithIdle(core, runnerId, () => {
        const a = core.claims.claim(runnerId, body);
        const ticket = String(a.ticket_id ?? '');
        if (ticket.includes(':')) {
          requireClaimKeyPolicy(core, cred, runnerId, Number(a.claim_id));
          const standing = core.sql<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', repositoryOf(ticket))[0];
          // Set once: a replay keeps the pairing the claim was made with, never the moved
          // board's (an empty string is the no-record shape, never NULL). Round 4: stored on
          // every claim, whatever the setting — stored only while it was on, a claim made
          // with it off and replayed after the owner turned it on backfilled the moved
          // board's record beside the old snapshot, and the runner refused the honest claim.
          // `claimControl` still answers `{}` unless the repository requires signed control.
          core.store.exec('UPDATE claims SET control_json = ? WHERE id = ? AND control_json IS NULL', standing?.control_json ?? '', Number(a.claim_id));
        }
        return a;
      });
      return json({ ...answer, ...await claimControl(core, String(answer.ticket_id ?? ''), Number(answer.claim_id ?? 0)) });
    }
    if (m === 'GET' && p === '/v1/runner/next') return json(core.claims.next(runnerId));
    if (m === 'GET' && p === '/v1/runner/recommendations') {
      // §11: `?limit=`, default 10, applied after the merge (R-BTN-61).
      const raw = url.searchParams.get('limit');
      const limit = raw == null ? 10 : Number(raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BatonError('invalid-params', 'limit: must be an integer from 1 to 50');
      return json(core.claims.recommendations(runnerId, limit, url.searchParams.get('all') === '1'));
    }
    const advance = /^\/v1\/runner\/claims\/(\d+)\/advance$/.exec(p);
    if (m === 'POST' && advance) {
      const body = await readJson(req);
      return json(tx(() => {
        requireClaimKeyPolicy(core, cred, runnerId, Number(advance[1]));
        return core.claims.advance(runnerId, Number(advance[1]), body);
      }));
    }
    if (m === 'POST' && p === '/v1/runner/adopt') {
      const body = await readJson(req);
      return json(tx(() => core.cutover.adopt(runnerId, body, (repo) => requireRegistrationScope(core, cred, [repo]))));
    }
    const end = /^\/v1\/runner\/claims\/(\d+)\/end$/.exec(p);
    if (m === 'POST' && end) {
      const body = await readJson(req);
      requireClaimKeyPolicy(core, cred, runnerId, Number(end[1]));
      // R-BTN-126 (round 1 B9, round 2 r2-5): a blocked end's ref must be a well-formed
      // capability the runner declares — judged before the request's transaction, so the
      // invalid end's recording (a failed attempt, ended transient) commits whether or not
      // the answer is the error.
      const prereq = (body as { prerequisite?: { kind?: string; ref?: unknown } }).prerequisite;
      if ((body as { end_reason?: string }).end_reason === 'released:blocked' && prereq?.kind === 'capability') {
        if (typeof prereq.ref !== 'string' || !CAPABILITY_NAME.test(prereq.ref)) throw new BatonError('invalid-params', 'prerequisite: must be a capability name (R-BTN-126)');
        const declared = core.sql('SELECT 1 FROM runner_capabilities wc JOIN claims c ON c.runner_id = wc.runner_id WHERE c.id = ? AND c.runner_id = ? AND wc.capability = ?', Number(end[1]), runnerId, prereq.ref);
        if (!declared.length) {
          core.store.transaction(() => core.claims.invalidPrerequisiteEnd(runnerId, Number(end[1]), prereq.ref as string));
          throw new BatonError('invalid-prerequisite', `prerequisite: ${prereq.ref} is not a capability this runner declares (R-BTN-126)`);
        }
      }
      return json(tx(() => core.claims.end(runnerId, Number(end[1]), body)));
    }
    // B-234 (R-BTN-160, R-BTN-195): the report a runner sends for each raise its channel
    // check passed. One transaction, like the advance and the end: the condition's row, its
    // event and its history row land together, and an `interact` closes the open one of the
    // same run in it.
    const conditions = /^\/v1\/runner\/claims\/(\d+)\/conditions$/.exec(p);
    if (m === 'POST' && conditions) {
      const body = await readJson(req);
      return json(tx(() => {
        requireClaimKeyPolicy(core, cred, runnerId, Number(conditions[1]));
        return core.conditions.report(runnerId, Number(conditions[1]), body);
      }));
    }
    if (m === 'POST' && p === '/v1/runner/readings') {
      // R-BTN-76, R-BTN-101: what a leg met — on its own runner instances and on any account
      // instance listing a repository its key works on.
      const body = await readJson(req);
      return json(core.resources.post({ kind: 'runner', runnerId, credential: cred }, body, grantedRepos(core, cred)));
    }
    if (m === 'POST' && p === '/v1/runner/activities') {
      const body = await readJson(req);
      return json(core.runners.activities(runnerId, body));
    }
    const ack = /^\/v1\/runner\/messages\/(\d+)\/ack$/.exec(p);
    if (m === 'POST' && ack) {
      // An absent body is an acknowledgement with no reply; a malformed one is refused.
      const body = req.headers.get('Content-Length') === '0' || !req.body ? null : await readJson(req);
      return json(tx(() => core.runners.ack(runnerId, Number(ack[1]), body)));
    }
    if (m === 'POST' && p === '/v1/runner/shadow-report') {
      const body = await readJson(req);
      return json(tx(() => core.runners.shadowReport(runnerId, body)));
    }
    return null;
  }
  return null;
}

/**
 * `/v1/courier/*` (§11): signed by a personal courier's key, or by a machine
 * key naming `?repository=` — granted there, its sessions having declared `couriers` for it within
 * the day — acting as a runner courier on that repository's pool, with no runner secret. A key in
 * any other role is `forbidden`.
 */
export async function courierRoute(core: Pick<BatonCore, 'admin' | 'config' | 'notices' | 'now' | 'outside' | 'ownerState' | 'runners' | 'sql' | 'store'>, req: Request, url: URL): Promise<Response> {
  if (!req.headers.has('X-Baton-Signed')) throw new BatonError('unauthenticated', 'sign with a courier key or a machine key (R-BTN-13)');
  const signed = await verifySigned(core, req);
  const fp = signed.cred;
  if ((await core.admin.adminFingerprints()).has(fp)) throw new BatonError('forbidden', 'an administrator key is never a courier key (R-BTN-57)');
  const cred = core.sql<{ kind: string; created_by: string | null }>('SELECT kind, created_by FROM credentials WHERE id = ?', fp)[0];
  const raw = url.searchParams.get('repository');
  let who: Courier;
  if (cred?.kind === 'courier') {
    if (raw != null) throw new BatonError('invalid-params', 'repository: only a machine key names one; a courier key claims its own notices');
    who = { kind: 'personal', fingerprint: fp };
  } else if (cred?.kind === 'runner') {
    if (raw == null) throw new BatonError('invalid-params', 'repository: a machine key delivers one repository’s pool at a time');
    const repository = checkRepositoryId(raw);
    requireGrant(core.store, fp, repository);
    const asks = core.notices.runnerAsks(fp, repository);
    if (!asks.length) throw new BatonError('forbidden', `no session of this key declared couriers for ${repository} within the day`);
    who = { kind: 'runner', fingerprint: fp, repository, asks };
  } else throw new BatonError('forbidden', 'only a courier key or a machine key delivers notices (R-BTN-57)');
  const p = url.pathname;
  const m = req.method;
  const tx = <T>(f: () => T): T => core.store.transaction(f);
  if (m === 'POST' && p === '/v1/courier/notices/claim') {
    const body = signed.req.headers.get('Content-Length') === '0' || !signed.req.body ? null : await readJson(signed.req);
    const limit = checkNoticeClaim(body);
    return json(tx(() => core.notices.claim(who, limit)));
  }
  const mark = /^\/v1\/courier\/notices\/([^/]+)$/.exec(p);
  if (m === 'POST' && mark) {
    const body = await readJson(signed.req);
    return json(tx(() => core.notices.mark(who, mark[1], body)));
  }
  if (m === 'GET' && p === '/v1/courier/decisions') return json(core.notices.decisions(who));
  throw new BatonError('not-found', `no route ${m} ${p}`);
}

/** The repositories a runner key works on (R-BTN-58), or null for a key no owner or
 *  administrator granted — a bearer token or a seed key, which reaches every one. */
function grantedRepos(core: Pick<BatonCore, 'runners' | 'sql' | 'store'>, cred: string): string[] | null {
  if (!core.runners.credential(cred).granted) return null;
  return core.sql<{ repository_id: string }>('SELECT repository_id FROM runner_grants WHERE credential_id = ? AND revoked_at IS NULL', cred).map((r) => r.repository_id).filter((repo) => runnerKeyAllowed(core.store, cred, repo));
}


function requireRegistrationScope(core: RunnerCore, cred: string, repositories: string[]): void {
  for (const repo of repositories) requireRunnerKeyPolicy(core.store, cred, repo);
  if (!core.sql('SELECT 1 FROM credentials WHERE id = ? AND registration_token_id IS NOT NULL', cred).length) return;
  const grants = grantedRepos(core, cred) ?? [];
  if (repositories.some((repo) => !grants.includes(repo))) throw new BatonError('forbidden', 'outside this registration grant');
}

function requireClaimKeyPolicy(core: RunnerCore, cred: string, runner: number, claim: number): void {
  const row = core.sql<{ ticket_id: string; api_lease_cap_at: number | null }>(
    'SELECT ticket_id, api_lease_cap_at FROM claims WHERE id = ? AND runner_id = ?', claim, runner)[0];
  if (!row) return;
  requireRunnerKeyPolicy(core.store, cred, repositoryOf(row.ticket_id));
  if (row.api_lease_cap_at !== null && row.api_lease_cap_at <= core.now()) {
    throw new BatonError('claim-ended', 'the claim lease expired');
  }
}

/** B-127: the signed-control record a claim answer carries while its repository requires
 *  signed control — the setting and the owner keys from Baton itself, the groups from the
 *  record stored on the claim by its own transaction (round 2's pairing: the answer and a
 *  lost-response replay serve the claim's own record, never a newer post's). `required` and
 *  `keys` are never the post's word; the groups' commits are the post's, and each runner
 *  verifies them against `keys` before loading, so a post that lied about a signature
 *  changes what a runner refuses, not what it runs. With the setting off, `{}`: nothing is
 *  gated, and the ticket's brief mark rides its row as ever. A group missing (`read` null or
 *  absent) is the fail-closed case — no signed version — and the runner treats it so. */
async function claimControl(core: Pick<BatonCore, 'sql' | 'admin'>, ticket: string, claimId: number): Promise<Pick<ClaimAnswer, 'control'>> {
  if (!ticket.includes(':')) return {};
  const repo = repositoryOf(ticket);
  if (!core.sql<{ flag: number }>('SELECT require_signed_control AS flag FROM repositories WHERE id = ?', repo)[0]?.flag) return {};
  const register = await core.admin.signingKeys(repo);
  const keys = register.map((k) => k.public_key);
  // The claim's own record, stored at the claim (0041): immutable from the answer's side.
  const stored = core.sql<{ control_json: string | null }>('SELECT control_json FROM claims WHERE id = ?', claimId)[0]?.control_json ?? null;
  let groups: Record<string, { read: string | null; key: string | null; unsigned: string[] }> = {};
  let recordKeys: string[] | null = null;
  try {
    const parsed = stored ? (JSON.parse(stored) as { keys?: unknown; groups: Record<string, { read: string | null; key: string | null; unsigned: string[] }> }) : null;
    groups = parsed?.groups ?? {};
    recordKeys = Array.isArray(parsed?.keys) ? parsed.keys.filter((k): k is string => typeof k === 'string') : null;
  } catch {
    groups = {};
  }
  // Round 4 (the register moved): the record was computed under the keys it names, and the
  // runner verifies under today's register. When the two differ — an owner key registered or
  // removed between the post and the claim — a disagreement is the record's age, not a lie
  // the claim should pay for: `register_moved` tells the runner to release such a claim as
  // a stale board (unpenalised) instead of `cannot-finish:spec`. It never changes what loads:
  // every check still runs against today's register, and the next post re-computes under it.
  const now = new Set(register.map((k) => k.fingerprint));
  const moved = recordKeys != null && (recordKeys.length !== now.size || recordKeys.some((k) => !now.has(k)));
  return { control: { required: true, keys, ...(moved ? { register_moved: true } : {}), ...groups } };
}

export async function probeRoute(core: Parameters<typeof verifySigned>[0] & Pick<BatonCore, 'sql' | 'resources'>, req: Request, url: URL): Promise<Response | null> {
  if (req.method !== 'POST' || url.pathname !== '/v1/probe/readings') return null;
  // R-BTN-53, R-BTN-101: a probe key's readings, on any registered instance.
  if (!req.headers.has('X-Baton-Signed')) throw new BatonError('unauthenticated', 'sign with a probe key');
  const signed = await verifySigned(core, req);
  const kind = core.sql<{ kind: string }>('SELECT kind FROM credentials WHERE id = ?', signed.cred)[0]?.kind;
  if (kind !== 'probe') throw new BatonError('forbidden', 'only a probe key posts here (R-BTN-57: one role per key)');
  const out = core.resources.post({ kind: 'probe', fingerprint: signed.cred }, await readJson(signed.req), null);
  return json(out);
}

/** B-244: an idle refusal may queue a notification, but never commits the refused claim's
 *  transaction. The existing unblocked alarm sends the committed queue. */
function claimWithIdle<T>(core: Pick<BatonCore, 'store' | 'config' | 'now' | 'blocks'>, runnerId: number, claim: () => T): T {
  try {
    return core.store.transaction(() => {
      const answer = claim();
      core.store.exec('DELETE FROM runner_idle WHERE runner_id = ?', runnerId);
      return answer;
    });
  } catch (e) {
    if (e instanceof BatonError && (e.code === 'no-eligible-ticket' || e.code === 'not-eligible' || e.code === 'stale-skills')) {
      const seconds = Number(core.config.BATON_IDLE_NOTIFY_AFTER_S);
      const threshold = (Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 1800) * 1000;
      core.store.transaction(() => noteIdle(core.store, runnerId, core.now(), threshold, e.extra.detail as IdleDetail | undefined,
        (repo) => core.blocks.queueIdleTrigger(repo)));
    }
    throw e;
  }
}

/** B-131: `GET /v1/forge-scope/{broker|runner}/{run}` — a forge broker's signed read of a live
 *  run's scope, or a runner's proof that the run is its own live session. Proof is a read, not a
 *  heartbeat: it never revives or extends the session it proves. */
export async function forgeScopeRoute(core: Parameters<typeof verifySigned>[0] & Pick<BatonCore, 'store' | 'admin'>, req: Request, path: string): Promise<Response> {
  const match = /^\/v1\/forge-scope\/(broker|runner)\/([^/]+)$/.exec(path);
  if (!match) throw new BatonError('not-found', 'no such route');
  if (!req.headers.has('X-Baton-Signed')) throw new BatonError('unauthenticated', 'a forge-scope read must be signed');
  if (match[1] === 'broker') {
    const keys = new Map<string, string>();
    for (const line of parseAdminKeys(core.config.BATON_FORGE_BROKER_KEYS ?? '')) {
      const key = await parseSshKey(line);
      keys.set(key.fingerprint, line);
    }
    await verifySigned(core, req, (fp) => keys.get(fp) ?? null);
    return json(forgeScope(core.store, core.now(), match[2]));
  }
  const { cred } = await verifySigned(core, req);
  if ((await core.admin.adminFingerprints()).has(cred)) throw new BatonError('forbidden', 'an administrator key is never a runner key');
  const secret = req.headers.get('X-Runner-Secret');
  if (!secret) throw new BatonError('unauthenticated', 'X-Runner-Secret is required after the first heartbeat');
  const secretHash = await core.outside(() => sha256Hex(secret));
  forgeScope(core.store, core.now(), match[2], { credential: cred, secretHash });
  return new Response(null, { status: 204 });
}
