// grants.ts — the live runner grant shared by routes, reads and reports (R-BTN-58).
import type { Store } from './ports';

export function hasGrant(store: Store, credential: string, repository: string): boolean {
  return store.exec('SELECT 1 FROM runner_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', credential, repository).toArray().length > 0;
}
