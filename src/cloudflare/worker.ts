// worker.ts — the Worker (BATON_SPEC §3): the front (src/core/front.ts) with the one Durable
// Object, fixed name, as the core behind it.
import { front } from '../core/front';
import { adminFingerprints, parseAdminKeys } from '../core/auth';
import { foreignHost, forTenant, objectId, servesHost, TENANT_ID } from '../shell/tenant';

export { Baton } from './baton';

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    if (!servesHost(req, env.BATON_ORIGIN)) {
      if (req.body && !req.bodyUsed) req.body.cancel().catch(() => {});
      return Promise.resolve(foreignHost(new URL(req.url).pathname, env));
    }
    return front(req, env, (r) => env.BATON.get(objectId(env.BATON, TENANT_ID)).fetch(forTenant(r, TENANT_ID)),
      async () => (await adminFingerprints(parseAdminKeys(env.BATON_ADMIN_KEYS ?? ''))).size > 0);
  },
} satisfies ExportedHandler<Env>;
