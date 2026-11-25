// reads/credentials.ts — what B-199 adds to the one grants read, `GET /v1/owner/{repository}/grants`
// (`owner.grant.list`, R-BTN-146, R-BTN-179): the credential screens' and the governance screens'
// fields, beside what `BatonCore.grantsView` already answers and never in place of it. Additive
// only — every field `grantsView` serves stays as it is, so the CLI's `baton owner grants` and
// `baton owner settings --code-repos` (which read `settings.code_repos`) read what they read.
//
// NEVER A SECRET (§12.1): a row here is a fingerprint, a label, a kind, who added it and when.
// No public key line (an API key's line carries the hash of the key), no token, no hash.
//
// What exists is served; what does not is named, never invented (the lead's ruling 2):
//   - `owners[]` gains `kind` (`ssh` or `api`, R-BTN-159) and `human_only` (R-BTN-185);
//   - `grants[]` gains `role`, `domain` and `set_by` (R-BTN-180: the columns the grant holds);
//   - `bars[]` gains `set_by` (R-BTN-67);
//   - `sync_keys` (R-BTN-93) and `dependency_consents` (§3.1, B-113) are new lists;
//   - `not_built` names the kinds no table holds: registration tokens (R-BTN-117), MCP keys
//     (R-BTN-130), the check-runner (cut on 2026-11-19, B-290), a grant's `pending`, `sync` and
//     `checker` marks (R-BTN-146) and the code-repository consent (R-BTN-140).
import type { ReadCtx } from './kit';

/** An owner key as the credential screens list it. */
export type OwnerRow = {
  repository_id: string;
  fingerprint: string;
  added_by: string;
  added_at: number;
  /** R-BTN-159: an API key's fingerprint is `bak_<id>`; every other owner key is an SSH key. */
  kind: 'ssh' | 'api';
  /** R-BTN-185: a key kept out of every agent's reach, the only kind a human gate counts. */
  human_only: boolean;
};

/** A sync key (R-BTN-93): the repository's sync or mirror proves itself with it. */
export type SyncKeyRow = { fingerprint: string; role: 'sync' | 'mirror'; added_by: string; added_at: number };

/** §3.1 (B-113): this repository's owners' consent to another repository's tickets depending
 *  on its own. `repository` is the dependent. */
export type DependencyConsentRow = { repository: string; granted_by: string; granted_at: number };

/** The kinds the ticket lists that nothing holds yet, each with the rule or ticket that builds
 *  it — what a screen says in place of a table. */
export const CREDENTIALS_NOT_BUILT = {
  tokens: 'R-BTN-117',
  mcp_keys: 'B-124',
  check_runners: 'B-290',
  grant_acceptance: 'R-BTN-146',
  code_repo_consents: 'R-BTN-140',
} as const;

/** What `owner.grant.list` answers beside `grantsView`'s own fields. */
export type CredentialExtras = {
  owners: OwnerRow[];
  sync_keys: SyncKeyRow[];
  dependency_consents: DependencyConsentRow[];
  not_built: typeof CREDENTIALS_NOT_BUILT;
};

type View = { owners: unknown[]; grants: Record<string, unknown>[]; bars: unknown[] } & Record<string, unknown>;

/** `grantsView`'s answer with B-199's fields: the same object, each list's rows widened and the
 *  new lists appended. */
export function withCredentials<V extends View>(cx: ReadCtx, repository: string, view: V): V & CredentialExtras {
  const owners = cx.sql<{ repository_id: string; fingerprint: string; added_by: string; added_at: number; human_only: number }>(
    'SELECT repository_id, fingerprint, added_by, added_at, human_only FROM repository_owners WHERE repository_id = ? AND removed_at IS NULL ORDER BY added_at', repository)
    .map((o) => ({ repository_id: o.repository_id, fingerprint: o.fingerprint, added_by: o.added_by, added_at: o.added_at, kind: o.fingerprint.startsWith('bak_') ? 'api' as const : 'ssh' as const, human_only: !!o.human_only }));
  const trust = new Map(cx.sql<{ credential_id: string; role: string | null; trust_domain: string | null; trust_set_by: string | null }>(
    'SELECT credential_id, role, trust_domain, trust_set_by FROM runner_grants WHERE repository_id = ? AND revoked_at IS NULL', repository).map((g) => [g.credential_id, g]));
  const setBy = new Map(cx.sql<{ id: number; set_by: string }>('SELECT id, set_by FROM owner_bars WHERE repository_id = ?', repository).map((b) => [b.id, b.set_by]));
  return {
    ...view,
    owners,
    grants: view.grants.map((g) => {
      const t = trust.get(String(g.credential_id));
      return { ...g, role: t?.role ?? null, domain: t?.trust_domain ?? null, set_by: t?.trust_set_by ?? null };
    }),
    bars: view.bars.map((b) => ({ ...(b as Record<string, unknown>), set_by: setBy.get((b as { id: number }).id) ?? null })),
    sync_keys: cx.sql<SyncKeyRow>(
      'SELECT fingerprint, role, added_by, added_at FROM sync_keys WHERE repository_id = ? AND revoked_at IS NULL ORDER BY role, added_at, fingerprint', repository),
    dependency_consents: cx.sql<DependencyConsentRow>(
      'SELECT dependent_id AS repository, granted_by, granted_at FROM dependency_consents WHERE repository_id = ? ORDER BY dependent_id', repository),
    not_built: CREDENTIALS_NOT_BUILT,
  };
}
