import { BatonError, type ErrorCode } from '../http';
import type { Registry } from '../registry';
import type { Store } from '../ports';
import { checkRepositoryId, qualify, repositoryOf, TICKET_ID } from '../validate';
import { hasGrant } from '../grants';

export function pathSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new BatonError('invalid-params', 'a malformed path segment');
  }
}

/** R-BTN-47: a retired repository answers as an unregistered one. Callers keep their existing refusal. */
export function liveRepoParam(registry: Pick<Registry, 'live'>, raw: unknown, refusal: (id: string) => [ErrorCode, string] = (id) => ['not-found', `no repository ${id}`]) {
  const id = checkRepositoryId(raw);
  const repo = registry.live(id);
  if (!repo) throw new BatonError(...refusal(id));
  return repo;
}

/** A local or qualified id, within the repository already authorized by the caller. */
export function ticketOf(repository: string, segment: string): string {
  const raw = pathSegment(segment);
  const ticket = raw.includes(':') ? raw : qualify(repository, raw);
  if (!TICKET_ID.test(ticket) || repositoryOf(ticket) !== repository) throw new BatonError('invalid-params', `ticket: must be a ticket of ${repository}`);
  return ticket;
}

export function requireGrant(store: Store, cred: string, repository: string): void {
  if (!hasGrant(store, cred, repository)) throw new BatonError('forbidden', `the key is not granted on ${repository} (R-BTN-58)`);
}

export function runnerSecret(req: Request) {
  const current = req.headers.get('X-Runner-Secret');
  const legacy = req.headers.get('X-Worker-Secret');
  if (current != null && legacy != null && current !== legacy) throw new BatonError('invalid-params', 'X-Runner-Secret and X-Worker-Secret differ');
  return { secret: current ?? legacy, legacyName: legacy != null };
}

/** A ticket in a path: a qualified id (R-BTN-47) of a registered repository. A malformed
 *  escape is the caller's error, never a 500. */
export function qualifiedTicket(core: { registry: Pick<Registry, 'get'> }, raw: string): string {
  let id = '';
  try {
    id = decodeURIComponent(raw);
  } catch {
    // falls through to the refusal
  }
  const m = TICKET_ID.exec(id);
  if (!m || !core.registry.get(m[1])) throw new BatonError('invalid-params', 'ticket: must be a ticket id, <repository>:<id>, of a registered repository');
  return id;
}
