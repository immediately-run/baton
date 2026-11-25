import type { BatonCore } from '../baton';
import { BatonError, json, readJson } from '../http';
import { SESSION_COOKIE } from '../admin';
import { checkAccept, checkAttestation, checkResync } from '../validate';
import { consentRoute } from '../dependencies';
import { logEvent } from '../db';
import { acceptsUnattestedHumanKey } from '../policy';
import { liveRepoParam, pathSegment, qualifiedTicket, ticketOf } from './kit';
import { authenticated, verifySigned, type PersonPrincipal } from './principal';

const RESYNC_WINDOW_MS = 30_000; // B-201: a session's resync, once per repository per R-BTN-73's dispatch window

type OwnerCore = Pick<BatonCore, 'registry' | 'admin' | 'store' | 'now' | 'policies' | 'claims' | 'humanBreakGlass' | 'questions' | 'blocks'>;

export async function ownerRoute(core: OwnerCore, req: Request, url: URL, principal: PersonPrincipal): Promise<Response | null> {
  const { cred: fp, administrator } = principal;
  const p = url.pathname;
  if (!p.startsWith('/v1/owner/')) return null;
  const m = req.method;
  const body = () => readJson(req);
  const optionalBody = async () => req.body ? body() : null;
  const seg = pathSegment;
  const o = /^\/v1\/owner\/([^/]+)\/(.+)$/.exec(p);
  if (!o) throw new BatonError('not-found', `no route ${m} ${p}`);
  const { id: repo, forge } = liveRepoParam(core.registry, seg(o[1]), (id) => ['not-found', `${id} is not registered`]);
  // An administrator's key is no owner's, even one added as an owner before it was listed (R-BTN-57).
  if (administrator) throw new BatonError('forbidden', 'an administrator key is never an owner key (R-BTN-57)');
  // Owning one repository confers nothing on another (R-BTN-58).
  if (!core.admin.owns(fp, repo)) throw new BatonError('forbidden', `this key does not own ${repo}`);
  const actor = `owner:${fp}`;
  const rest = o[2];
  // B-90: the repository's grants and settings — and the policy's log below — are read in
  // src/core/reads/repository.ts (B-192: a session's reads too).
  // B-127: the repository's owner signing keys — public keys of its human-only owners — the
  // read `baton owner verify-config` carries into a checkout (the same list the sync's
  // observation serves its own credential).
  if (m === 'GET' && rest === 'signing-keys') return json({ keys: await core.admin.signingKeys(repo) });
  if (m === 'POST' && rest === 'grants') return json(await core.admin.grant(actor, repo, await body(), 'owner'));
  const rg = /^grants\/([^/]+)\/revoke$/.exec(rest);
  if (m === 'POST' && rg) return json(await core.admin.revokeGrant(actor, repo, seg(rg[1]), await optionalBody()));
  if (m === 'POST' && rest === 'owners') return json(await core.admin.owners(actor, repo, await body()));
  // B-113 (R-BTN-140's precedent): the repository's owners' consent to another repository's
  // tickets depending on theirs — the consent a dependency on a less visible repository needs
  // (§3.1). Given here, never by the dependent's own settings; `{withdraw: true}` takes it back.
  if (m === 'POST' && rest === 'dependency-consents') return json(consentRoute(core.store, () => core.now(), repo, actor, await body(), () => core.blocks.refreshPrerequisiteVisibility()));
  if (m === 'POST' && rest === 'bars') return json(core.admin.setBar(actor, repo, await body()));
  const lift = /^bars\/(\d+)\/lift$/.exec(rest);
  if (m === 'POST' && lift) return json(core.admin.liftBar(actor, repo, Number(lift[1])));
  if (m === 'PUT' && rest === 'settings') return json(await core.admin.setSettings(actor, repo, await body()));
  if (m === 'POST' && rest === 'couriers') return json(await core.admin.couriers(actor, repo, await body()));
  // §12.8 (B-145): the repository policy's routes (R-BTN-188, R-BTN-189). A change is one
  // transaction — the compare-and-set, the approver check against the list in force, the
  // floors and the satisfiable-list refusals all inside it.
  if (m === 'PUT' && rest === 'policy') {
    const b = await body();
    const breakGlass = new Set((await core.humanBreakGlass()).keys());
    const admins = await core.admin.adminFingerprints();
    const personAnswerStops = () => core.admin.hasHumanDecisionWriter(breakGlass, admins) ? []
      : core.questions.answerableLegs(repo);
    return json(core.store.transaction(() => core.policies.put(repo, b, forge, { credential: fp, label: actor }, { breakGlass, personAnswerStops })));
  }
  if (m === 'POST' && rest === 'policy/floors') {
    const b = await body();
    const breakGlass = await core.humanBreakGlass();
    return json(core.store.transaction(() => core.policies.floorsRoute(repo, b, { credential: fp, label: actor }, new Set(breakGlass.keys()))));
  }
  const resolve = /^tickets\/([^/]+)\/resolve$/.exec(rest);
  if (m === 'POST' && resolve) {
    // An owner answers one of Baton's own decisions on a ticket of this repository.
    // A local id is this repository's, as the repository reads take it (§11).
    const ticket = ticketOf(repo, resolve[1]);
    const b = await body();
    return json(core.store.transaction(() => core.claims.resolveDecision(fp, ticket, b)));
  }
  return null;
}

export async function dashboardSessionRoute(core: Pick<BatonCore, 'admin'>, req: Request, url: URL, _principal: string): Promise<Response | null> {
  if (req.method === 'GET' && url.pathname === '/v1/ui/session') return json({ ok: true });
  // B-206 (R-BTN-155, `ui.logout`): a session's own end — its row is revoked and the
  // cookie cleared, with the attributes it was set with (R-BTN-16). The caller is the
  // principal just resolved; nothing but its own session is named or ended.
  if (req.method === 'POST' && url.pathname === '/v1/ui/logout') {
    await readJson(req); // R-BTN-16's JSON body, read whole; it names nothing
    await core.admin.endSession(req.headers.get('X-Baton-Session'));
    const res = json({ ok: true });
    res.headers.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
    return res;
  }

  return null;
}

export async function dashboardWriteRoute(core: Pick<BatonCore, 'store' | 'runners' | 'claims' | 'cutover' | 'registry' | 'scope' | 'sql' | 'now' | 'syncNow'>, req: Request, url: URL, owner: string): Promise<Response | null> {
  const p = url.pathname;
  if (!p.startsWith('/v1/ui/') || req.method !== 'POST') return null;
  const tx = <T>(f: () => T): T => core.store.transaction(f);
  if (p === '/v1/ui/messages') {
    const body = await readJson(req);
    return json(tx(() => core.runners.sendMessage(owner, body)));
  }
  const reap = /^\/v1\/ui\/claims\/(\d+)\/reap$/.exec(p);
  if (reap) {
    const body = await readJson(req);
    return json(tx(() => core.claims.forceReap(owner, Number(reap[1]), body)));
  }
  // R-BTN-19: an administrator's fence clear, in one transaction with its seats' release
  // (R-BTN-178) and its event. A dashboard session's principal is an administrator's — the
  // only key a session is minted from — so the route itself needs no further check.
  const fenceClear = /^\/v1\/ui\/claims\/(\d+)\/fence-clear$/.exec(p);
  if (fenceClear) {
    const body = await readJson(req);
    return json(tx(() => core.claims.fenceClear(owner, Number(fenceClear[1]), body)));
  }
  // B-222 (R-BTN-10, §9.6): the completion's confirm and its release, each a route of its
  // own over `claims.resolve`. V1's one route taking `{action}` is retired (B-203).
  const completion = /^\/v1\/ui\/claims\/(\d+)\/(confirm|release)$/.exec(p);
  if (completion) {
    const body = await readJson(req);
    // `confirm` is the caller's own word (§12.2): `checkResolve` refuses a body without it.
    const confirm = (body as { confirm?: unknown } | null)?.confirm;
    return json(tx(() => core.claims.resolve(owner, Number(completion[1]), { action: completion[2], confirm })));
  }
  if (p === '/v1/ui/cutover') {
    const body = await readJson(req);
    return json(tx(() => core.cutover.cutover(owner, body)));
  }
  const adoption = /^\/v1\/ui\/adoptions\/([^/]+)\/confirm$/.exec(p);
  if (adoption) {
    const { id: ticket, repository } = qualifiedTicket(adoption[1]);
    const body = await readJson(req);
    return json(tx(() => {
      liveRepoParam(core.registry, repository);
      return core.cutover.confirmAdoption(owner, ticket, body);
    }));
  }
  const override = /^\/v1\/ui\/overrides\/([^/]+)$/.exec(p);
  if (override) {
    const { id: ticket, repository } = qualifiedTicket(override[1]);
    const body = await readJson(req);
    return json(tx(() => {
      liveRepoParam(core.registry, repository);
      return core.claims.setOverride(owner, ticket, body);
    }));
  }
  // B-134: an owner resolves a scope finding — the acknowledgement that it was looked at.
  // In the transaction, like every neighbouring `/v1/ui` mutation, so the resolution and
  // its `scope-resolved` event land together.
  const finding = /^\/v1\/ui\/scope\/(\d+)\/resolve$/.exec(p);
  if (finding) {
    const id = Number(finding[1]);
    return json(tx(() => {
      if (!core.scope.resolve(id, `owner:${owner}`)) throw new BatonError('not-found', `no open scope finding ${id}`);
      return { ok: true };
    }));
  }
  if (p === '/v1/ui/board/accept') {
    const input = checkAccept(await readJson(req));
    return json(tx(() => {
      liveRepoParam(core.registry, input.repository);
      return core.claims.acceptHeld(owner, input);
    }));
  }
  // B-201 (`repo.resync`; R-BTN-73): a session asks the repository's sync to run now — the
  // dispatch a webhook delivery sends, logged with who asked, at most one per repository per
  // dispatch window. Nothing of the board moves here: the sync posts, and R-BTN-11 judges
  // its post. A forced resync is not built and is refused by name (`checkResync`).
  if (p === '/v1/ui/resync') {
    const { repository } = checkResync(await readJson(req));
    const repo = liveRepoParam(core.registry, repository, () => ['forbidden', 'this repository is not yours or does not exist']);
    if (!repo.sync_workflow) throw new BatonError('conflict', `${repository} registers no sync workflow: Baton has nothing to dispatch for it`);
    tx(() => {
      const now = core.now();
      // The request is an `admin` event (`act: resync`), as an administrator's other acts are:
      // the window reads the last one, so no new event kind and no table is needed.
      const last = core.sql<{ at: number }>(
        `SELECT at FROM events WHERE kind = 'admin' AND at > ? AND repository_id = ? AND json_extract(detail_json, '$.act') = 'resync' ORDER BY at DESC, seq DESC LIMIT 1`,
        now - RESYNC_WINDOW_MS, repository)[0];
      if (last) throw new BatonError('conflict', `a resync of ${repository} was asked for under ${RESYNC_WINDOW_MS / 1000} seconds ago`);
      logEvent(core.store, now, 'admin', `owner:${owner}`, { act: 'resync' }, null, null, repository);
    });
    core.syncNow([repository]);
    return json({ ok: true });
  }

  return null;
}

/** `POST /v1/human-keys` (R-BTN-185, B-145): a `human_only` key's own route — each later key
 *  registered with a signature by an existing one, a revocation refused while a list or a
 *  floor needs the key. Signed by a human_only key: the tenant's registered ones and the
 *  host's BATON_HUMAN_KEYS lines. */
export async function humanKeysRoute(core: Parameters<typeof verifySigned>[0] & Pick<BatonCore, 'admin' | 'sql' | 'humanBreakGlass'>, req: Request): Promise<Response> {
  if (!req.headers.has('X-Baton-Signed')) throw new BatonError('unauthenticated', 'sign with a human_only key (R-BTN-185)');
  const breakGlass = await core.humanBreakGlass();
  const registered = new Map(core.sql<{ fingerprint: string; public_key: string }>('SELECT fingerprint, public_key FROM human_keys WHERE revoked_at IS NULL').map((k) => [k.fingerprint, k.public_key]));
  const lookup = (fp: string) => breakGlass.get(fp) ?? registered.get(fp) ?? null;
  const signed = await verifySigned(core, req, lookup);
  if (!lookup(signed.cred)) throw new BatonError('unauthenticated', 'the key is not registered or is revoked');
  const body = await readJson(signed.req);
  return json(await core.admin.humanKeys(body, signed.cred, new Set(breakGlass.keys())));
}

export async function attestationRoute(core: Parameters<typeof authenticated>[0] & Pick<BatonCore, 'registry' | 'admin' | 'policies' | 'store' | 'questions'>, req: Request, url: URL): Promise<Response | null> {
  // R-BTN-181's envelope (§14), B-7's slice: `POST /v1/repositories/{repository}/attestations`
  // with a `std:decision@1` — a person's answer to the ticket's queued person leg
  // (R-BTN-116), what `baton decision answer` writes (R-BTN-127). An owner key of the
  // repository or a human-only key (R-BTN-185) writes it; an administrator's key is never an
  // owner's (R-BTN-57) and writes nothing here.
  const attestation = /^\/v1\/repositories\/([^/]+)\/attestations$/.exec(url.pathname);
  if (req.method === 'POST' && attestation) {
    const { id: repo } = liveRepoParam(core.registry, pathSegment(attestation[1]));
    if (!req.headers.has('X-Baton-Signed') && !req.headers.has('X-Baton-Api-Key')) {
      throw new BatonError('unauthenticated', 'sign with an owner key of the repository or a human-only key, or send its API key');
    }
    const admins = await core.admin.adminFingerprints();
    // R-BTN-185: an owner key of the repository, or a human-only one — a registered human
    // key's own public line serves the signature lookup, not the host's break-glass lines
    // alone (a key registered through POST /v1/human-keys owns nothing, but answers).
    const signed = await authenticated(core, req, (fp) => admins.get(fp) ?? core.admin.decisionKeyLine(fp));
    const fp = signed.cred;
    const human = await core.admin.isHumanKey(fp);
    const policy = core.policies.current(repo)?.policy;
    if (admins.has(fp)) throw new BatonError('forbidden', 'an administrator’s key is never an owner key (R-BTN-57); a person’s answer is an owner’s or a human-only key’s');
    if (!human && !core.admin.owns(fp, repo)) throw new BatonError('forbidden', `this key neither owns ${repo} nor is a human-only key (R-BTN-116, R-BTN-185)`);
    if (human && !acceptsUnattestedHumanKey(policy?.human_key ?? 'any')) {
      throw new BatonError('forbidden', `${repo}'s policy requires an attested hardware key for a human answer (R-BTN-185)`);
    }
    // §12.8, R-BTN-191: where the policy's `inputs.answers` is `attestation` (`protected`),
    // a person's answer counts from a human key alone — an owner key's does not.
    if (!human && policy?.inputs.answers === 'attestation') {
      throw new BatonError('forbidden', `${repo}'s policy counts a person's answer from a human key alone (inputs.answers: attestation)`);
    }
    const b = checkAttestation(await readJson(signed.req), repo);
    return json(core.store.transaction(() => core.questions.answer(repo, b.ticket, b.value, human ? `human:${fp}` : `owner:${fp}`)));
  }
  return null;
}
