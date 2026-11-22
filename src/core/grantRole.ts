import { KEY_FINGERPRINT } from './auth';

export const GRANT_DOMAIN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** R-BTN-180: shared by the role write and owner-state import. */
export function grantRoleProblem(
  role: unknown, domain: unknown, checker: boolean, claimedTrusted: boolean,
  credential: { id: string; kind: unknown; public_key?: unknown },
  peers: { checker?: unknown; trust_domain?: unknown }[],
): [field: string, why: string] | null {
  if (role != null && role !== 'runner' && role !== 'trusted-runner') return ['role', 'must be runner or trusted-runner'];
  if (domain != null && (typeof domain !== 'string' || !GRANT_DOMAIN.test(domain))) return ['domain', 'must be a domain label'];
  if (role === 'trusted-runner') {
    if (domain == null) return ['domain', 'a trusted runner needs a domain'];
    if (credential.kind !== 'runner' || typeof credential.public_key !== 'string' || !credential.public_key || !KEY_FINGERPRINT.test(credential.id)) {
      return ['role', 'a trusted runner must sign with an SSH key'];
    }
  }
  if (checker && role !== 'trusted-runner') return ['checker', 'a checker must be a trusted runner'];
  if (checker && claimedTrusted) return ['checker', 'this key has already claimed a trusted leg on the repository'];
  if (checker && peers.some(p => p.checker === 1)) return ['checker', 'this repository already has a checker'];
  if (domain != null && peers.some(p => p.trust_domain === domain && (checker || p.checker === 1))) {
    return ['domain', 'a checker cannot share its domain with another grant'];
  }
  return null;
}
