import type { BatonCore } from '../baton';
import { BatonError, errorResponse, json, readJson } from '../http';
import { dispatchRead } from '../reads';
import { adminRoute } from './admin';
import { attestationRoute, dashboardSessionRoute, dashboardWriteRoute, humanKeysRoute, ownerRoute } from './owner';
import { authenticated, dashboardPrincipal, personPrincipal } from './principal';
import { publicRoute, sequenceRoute } from './public';
import { courierRoute, forgeScopeRoute, probeRoute, runnerPrincipal, runnerRoute } from './runner';
import { RegistrationTokens } from '../registrationTokens';
import { requireOwnerWrite } from './kit';
import { syncPrincipal, syncRoute } from './sync';

export async function dispatchRoute(core: BatonCore, req: Request, url: URL): Promise<Response> {
  try {
    // R-BTN-88 (§4.8, R3-1258): a sealed Baton serves an administrator's reads alone — the
    // export among them — and refuses everything else `sealed` (503, retryable elsewhere).
    const sealedAt = core.ownerState.sealedAt();
    if (sealedAt != null && !(req.method === 'GET' && url.pathname.startsWith('/v1/admin/'))) {
      throw new BatonError('sealed', `this Baton was sealed at ${new Date(sealedAt).toISOString()} for its move; an administrator's reads alone are served (R-BTN-88)`);
    }
    // R-BTN-88: a frozen Baton refuses new claims (the claims' own gate) and owner writes —
    // lease upkeep, syncs and the administrator's own acts run on, so work drains and the
    // mirrors catch up before the seal. A person's attestation is an owner's write.
    if (core.ownerState.frozenAt() != null) {
      const ownerWrite = (req.method === 'POST' || req.method === 'PUT')
        && (url.pathname === '/v1/register' || url.pathname.startsWith('/v1/owner/') || /^\/v1\/repositories\/[^/]+\/attestations$/.test(url.pathname));
      if (ownerWrite) throw new BatonError('frozen', 'this Baton is frozen for a move: owner writes are refused until it is unfrozen or sealed (R-BTN-88)');
    }

    const path = url.pathname;
    const sync = await syncRoute(core, req, url, syncPrincipal(core, req));
    if (sync) return sync;
    if (req.method === 'POST' && path === '/v1/human-keys') return await humanKeysRoute(core, req);
    const read = await dispatchRead({ core, store: core.store, sql: (q, ...p) => core.sql(q, ...p), now: () => core.now(), config: core.config }, req, url);
    if (read) return read;
    if (path.startsWith('/v1/admin/') || path.startsWith('/v1/owner/')) {
      const principal = await personPrincipal(core, req);
      const res = path.startsWith('/v1/admin/')
        ? await adminRoute(core, principal.req, url, principal)
        : await ownerRoute(core, principal.req, url, principal);
      if (res) return res;
      throw new BatonError('not-found', `no route ${req.method} ${path}`);
    }
    const open = await publicRoute(core, req, url, { accessEmail: req.headers.get('X-Baton-Access-Email') });
    if (open) return open;
    let owner: string | null = null;
    if (path.startsWith('/v1/ui/')) {
      owner = await dashboardPrincipal(core.admin, req);
      const session = await dashboardSessionRoute(core, req, url, owner);
      if (session) return session;
    }
    const attestation = await attestationRoute(core, req, url);
    if (attestation) return attestation;
    const sequence = await sequenceRoute(core, req, url);
    if (sequence) return sequence;
    if (path.startsWith('/v1/courier/')) return await courierRoute(core, req, url);
    if (req.method === 'POST' && url.pathname === '/v1/register') {
      const auth = req.headers.get('Authorization') ?? '';
      const renewal = req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key');
      const token = renewal ? req.headers.get('Baton-Registration-Token') : /^Baton-Token (.+)$/.exec(auth)?.[1];
      if (!token) throw new BatonError('unauthenticated', 'a registration token is required');
      const caller = renewal ? await authenticated(core, req) : { req, cred: null };
      const body = await readJson(caller.req);
      return json(await new RegistrationTokens(core.store, () => core.now()).register(token, body, caller.cred, await core.admin.registrationKeyInUse(), () => requireOwnerWrite(core.ownerState)));
    }
    if (req.method === 'GET' && path.startsWith('/v1/forge-scope/')) return await forgeScopeRoute(core, req, path);
    const probe = await probeRoute(core, req, url);
    if (probe) return probe;
    const runner = await runnerPrincipal(core, req);
    const res = owner === null
      ? await runnerRoute(core, runner.req, url, runner)
      : await dashboardWriteRoute(core, runner.req, url, owner);
    if (res) return res;
    throw new BatonError('not-found', `no route ${req.method} ${path}`);
  } catch (e) {
    // Drain an unread body so the forwarded stream completes before the response does.
    if (req.body && !req.bodyUsed) await req.arrayBuffer().catch(() => {});
    if (e instanceof BatonError) return errorResponse(e.code, e.message, e.extra);
    throw e;
  }
}
