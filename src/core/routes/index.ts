import type { BatonCore } from '../baton';
import { BatonError, errorResponse } from '../http';
import { dispatchRead } from '../reads';
import { adminRoute } from './admin';
import { admitsBreakGlass, attestationRoute, dashboardSessionRoute, humanKeysRoute, ownerRoute } from './owner';
import { operatorRoute } from './operator';
import { dashboardPrincipal, personPrincipal } from './principal';
import { publicRoute, sequenceRoute } from './public';
import { courierRoute, forgeScopeRoute, probeRoute, runnerPrincipal, runnerRoute } from './runner';
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
        && (url.pathname.startsWith('/v1/owner/') || /^\/v1\/repositories\/[^/]+\/attestations$/.test(url.pathname));
      if (ownerWrite) throw new BatonError('frozen', 'this Baton is frozen for a move: owner writes are refused until it is unfrozen or sealed (R-BTN-88)');
    }

    const path = url.pathname;
    const sync = await syncRoute(core, req, url, syncPrincipal(core, req));
    if (sync) return sync;
    if (req.method === 'POST' && path === '/v1/human-keys') return await humanKeysRoute(core, req);
    const read = await dispatchRead({ core, store: core.store, sql: (q, ...p) => core.sql(q, ...p), now: () => core.now(), config: core.config }, req, url);
    if (read) return read;
    if (path.startsWith('/v1/admin/') || path.startsWith('/v1/owner/')) {
      const breakGlass = admitsBreakGlass(req.method, path) && req.headers.has('X-Baton-Signed') ? await core.humanBreakGlass() : undefined;
      const principal = await personPrincipal(core, req, breakGlass);
      const operator = await operatorRoute(core, principal.req, url, principal.cred, principal.administrator ? 'administrator' : 'owner');
      if (operator) return operator;
      const res = path.startsWith('/v1/admin/')
        ? await adminRoute(core, principal.req, url, principal)
        : await ownerRoute(core, principal.req, url, principal);
      if (res) return res;
      throw new BatonError('not-found', `no route ${req.method} ${path}`);
    }
    const open = await publicRoute(core, req, url, { accessEmail: req.headers.get('X-Baton-Access-Email') });
    if (open) return open;
    if (path.startsWith('/v1/ui/')) {
      const owner = await dashboardPrincipal(core.admin, req);
      const session = await dashboardSessionRoute(core, req, url, owner);
      if (session) return session;
      const operator = await operatorRoute(core, req, url, owner, 'session');
      if (operator) return operator;
      throw new BatonError('not-found', `no route ${req.method} ${path}`);
    }
    const attestation = await attestationRoute(core, req, url);
    if (attestation) return attestation;
    const sequence = await sequenceRoute(core, req, url);
    if (sequence) return sequence;
    if (path.startsWith('/v1/courier/')) return await courierRoute(core, req, url);
    if (req.method === 'GET' && path.startsWith('/v1/forge-scope/')) return await forgeScopeRoute(core, req, path);
    const probe = await probeRoute(core, req, url);
    if (probe) return probe;
    const runner = await runnerPrincipal(core, req);
    const res = await runnerRoute(core, runner.req, url, runner);
    if (res) return res;
    throw new BatonError('not-found', `no route ${req.method} ${path}`);
  } catch (e) {
    // Drain an unread body so the forwarded stream completes before the response does.
    if (req.body && !req.bodyUsed) await req.arrayBuffer().catch(() => {});
    if (e instanceof BatonError) return errorResponse(e.code, e.message, e.extra);
    throw e;
  }
}
