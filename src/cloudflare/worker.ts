// worker.ts — the Worker (BATON_SPEC §3): the front (src/core/front.ts) with the one Durable
// Object, fixed name, as the core behind it.
import { front } from '../core/front';
import { adminFingerprints, parseAdminKeys } from '../core/auth';

export { Baton } from './baton';

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    const baton = env.BATON.get(env.BATON.idFromName('baton'));
    return front(req, env, (r) => baton.fetch(r),
      async () => (await adminFingerprints(parseAdminKeys(env.BATON_ADMIN_KEYS ?? ''))).size > 0);
  },
} satisfies ExportedHandler<Env>;
