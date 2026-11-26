import { BatonError } from './http';
import type { Store } from './ports';

/** R-BTN-159 / S-BTN-69: the setting applies to runner operations on this repository,
 * not to the credential's other repositories or to API keys acting as owners/admins. */
export function runnerKeyAllowed(store: Store, credential: string, repository: string): boolean {
  return !credential.startsWith('bak_') || !store.exec('SELECT 1 FROM repositories WHERE id = ? AND api_keys = 0', repository).toArray().length;
}

export function requireRunnerKeyPolicy(store: Store, credential: string, repository: string): void {
  if (!runnerKeyAllowed(store, credential, repository)) throw new BatonError('forbidden', `${repository} does not allow API-key runners`);
}
