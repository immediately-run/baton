import type { OwnerState } from '../ownerState';
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

const qualifiedTicketError = 'ticket: must be a ticket id, <repository>:<id>, of a registered repository';

/** Parse the path id; callers decide whether the repository must be live. */
export function qualifiedTicket(raw: string): { id: string; repository: string } {
  let id = '';
  try {
    id = decodeURIComponent(raw);
  } catch {
    // falls through to the refusal
  }
  const m = TICKET_ID.exec(id);
  if (!m) throw new BatonError('invalid-params', qualifiedTicketError);
  return { id, repository: m[1] };
}

/** R-BTN-47: the holder query may still read a retired repository. */
export function holderTicket(registry: Pick<Registry, 'get'>, raw: string): string {
  const { id, repository } = qualifiedTicket(raw);
  if (!registry.get(repository)) throw new BatonError('invalid-params', qualifiedTicketError);
  return id;
}
export function requireOwnerWrite(ownerState: Pick<OwnerState, 'sealedAt' | 'frozenAt'>): void {
  const sealedAt = ownerState.sealedAt();
  if (sealedAt != null) throw new BatonError('sealed', `this Baton was sealed at ${new Date(sealedAt).toISOString()} for its move; an administrator's reads alone are served (R-BTN-88)`);
  if (ownerState.frozenAt() != null) throw new BatonError('frozen', 'this Baton is frozen for a move: owner writes are refused until it is unfrozen or sealed (R-BTN-88)');
}
