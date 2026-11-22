import type { BatonCore } from '../baton';
import { BatonError, json, readJson } from '../http';
import { checkRepositoryId } from '../validate';
import { stateView } from '../views';
import { pathSegment } from './kit';
import type { PersonPrincipal } from './principal';

type AdminCore = Parameters<typeof stateView>[0] & Pick<BatonCore, 'ownerState' | 'store' | 'flushDispatch'>;

export async function adminRoute(core: AdminCore, req: Request, url: URL, principal: PersonPrincipal): Promise<Response | null> {
  const { cred: fp, administrator } = principal;
  const p = url.pathname;
  if (!p.startsWith('/v1/admin/')) return null;
  const m = req.method;
  const body = () => readJson(req);
  const seg = pathSegment;
  if (!administrator) throw new BatonError('forbidden', 'an administrator’s key is required (R-BTN-57)');
  const actor = `admin:${fp}`;
  // `GET /v1/admin/repositories` and `GET /v1/admin/capacities` are reads of
  // src/core/reads/tenant.ts (B-202), answered before this route is reached.
  // B-118, B-216 (R-BTN-57, R-BTN-179): the state in one request for a terminal —
  // `stateView()`, built by the functions the entity reads use, so the two cannot drift.
  if (m === 'GET' && p === '/v1/admin/state') return json(stateView(core));
  if (m === 'POST' && p === '/v1/admin/repositories') return json(await core.admin.repositories(actor, await body()));
  if (m === 'POST' && p === '/v1/admin/probes') return json(await core.admin.addProbe(actor, await body()));
  // R-BTN-76: external resources, their account instances, and a reading by hand.
  if (m === 'POST' && p === '/v1/admin/resources') return json(core.resources.addResource(actor, await body()));
  if (m === 'POST' && p === '/v1/admin/instances') return json(core.resources.addInstance(actor, await body()));
  if (m === 'POST' && p === '/v1/admin/readings') {
    const b = await body();
    // R-BTN-76, R-BTN-151: a reading, or `{instance, clear}` to end the readings in force there.
    if (b && typeof b === 'object' && !Array.isArray(b) && (b as { clear?: unknown }).clear !== undefined) return json(core.resources.clear(actor, b));
    return json(core.resources.post({ kind: 'admin', fingerprint: fp }, b, null));
  }
  // R-BTN-178: a capability's capacity. The read `baton admin capacity set` prints before
  // it asks to confirm is `admin.capacity.list` (src/core/reads/tenant.ts).
  if (m === 'PUT' && p === '/v1/admin/capacities') return json(core.resources.setCapacity(actor, await body()));
  // B-4 (R-BTN-113, §13.1): the instance settings — `link_hosts`, `session_hosts` and
  // `check_app_id`, each given replacing its own whole.
  if (m === 'PUT' && p === '/v1/admin/settings') return json(core.instance.set(actor, await body()));
  // R-BTN-88 (§4.8, R3-1258): the move — freeze, unfreeze, seal, export, import. An
  // administrator's alone, and the writes a freeze refuses do not touch them: the
  // administrator drives the move through it.
  if (m === 'POST' && p === '/v1/admin/freeze') return json(core.store.transaction(() => core.ownerState.freeze(actor)));
  if (m === 'POST' && p === '/v1/admin/unfreeze') return json(core.store.transaction(() => core.ownerState.unfreeze(actor)));
  if (m === 'POST' && p === '/v1/admin/seal') {
    // §4.8: a refused seal still dispatches the lagging mirrors' workflows (R-BTN-94) — the
    // dispatch the seal asked for goes out with the refusal, so the mirrors catch up and the
    // administrator can seal once they have.
    try {
      return json(core.store.transaction(() => core.ownerState.seal(actor)));
    } catch (e) {
      if (e instanceof BatonError) core.flushDispatch();
      throw e;
    }
  }
  if (m === 'GET' && p === '/v1/admin/export') return json(core.ownerState.export(url.searchParams.get('with_history') === '1'));
  if (m === 'POST' && p === '/v1/admin/import') {
    const b = await body();
    return json(core.store.transaction(() => core.ownerState.import(actor, b)));
  }
  if (m === 'POST' && p === '/v1/admin/grants') {
    const b = await body();
    const repo = checkRepositoryId((b as { repository?: unknown } | null)?.repository);
    return json(await core.admin.grant(actor, repo, b, 'admin'));
  }
  const revoke = /^\/v1\/admin\/keys\/([^/]+)\/revoke$/.exec(p);
  if (m === 'POST' && revoke) return json(await core.admin.revokeKey(actor, seg(revoke[1])));
  if (m === 'POST' && p === '/v1/admin/login-links') return json(await core.admin.loginLink(fp));
  return null;
}
