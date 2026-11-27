import type { Ports } from '../ports';
import type { BatonCore } from '../baton';
import type { ReadPrincipal } from '../reads/kit';
import { BatonError } from '../http';
import { parseAdminKeys, parseSshKey, verifyApiKey, verifyRequest, withBody } from '../auth';

type SignedCore = Pick<BatonCore, 'now' | 'outside' | 'config' | 'runners' | 'ownerState'>;

/** A signed request (R3-1239), verified whole by the one verifier: the key its keyid names
 *  among the keys in force, the SSHSIG in the `baton-request` namespace, `created` within 5
 *  minutes of this clock — then its nonce, unseen for that key. The crypto runs outside the
 *  turn (§3); the nonce is checked and written after it. Returns the request with its body
 *  put back and the credential: the key's fingerprint. */
export async function verifySigned(core: SignedCore, req: Request, lookup: (fp: string) => string | null = (fp) => core.runners.publicKey(fp)): Promise<{ req: Request; cred: string }> {
  const now = core.now();
  const v = await core.outside(() => verifyRequest(req, lookup, { origin: core.config.BATON_ORIGIN, now }));
  // R-BTN-88 (§4.8): an import sets the floor a signed request's `created` must stand above —
  // the source's `sealed_at`. A request signed at or before it is a captured one, replayed
  // against the instance its state moved to: it reaches nothing.
  const floor = core.ownerState.signCreatedFloor();
  if (floor != null && v.created <= floor) throw new BatonError('unauthenticated', 'the request was signed before this Baton\'s state was sealed and moved: sign it again (R-BTN-88)');
  // Another request ran meanwhile: the key may have been revoked since it was read.
  if (!lookup(v.keyid)) throw new BatonError('unauthenticated', 'the key is not registered or is revoked');
  core.runners.acceptNonce(v.keyid, v.nonce, now);
  return { req: withBody(req, v.body), cred: v.keyid };
}

/** R-BTN-13 or R-BTN-159: a signed request's key, or an API key's fingerprint — whichever the
 *  front passed — checked against `lookup`. */
export async function authenticated(core: SignedCore, req: Request, lookup?: (fp: string) => string | null): Promise<{ req: Request; cred: string }> {
  const apiKey = req.headers.get('X-Baton-Api-Key');
  if (apiKey == null) return verifySigned(core, req, lookup);
  return { req, cred: await verifyApiKey(apiKey, lookup ?? ((fp) => core.runners.publicKey(fp))) };
}

/** B-192: who reads — the one resolution of a read's caller into a principal. A signed
 *  request or an API key is that key's, whatever cookie came with it (the front attaches no
 *  session to one): an administrator's, an owner's or a runner's, by the key. A bearer token
 *  the front verified is a runner's. Else the dashboard session, which authorizes with its
 *  minting key's role (R-BTN-155) — an administrator's alone until B-76 builds an owner's
 *  sign-in, whose branch `canRead` (src/core/reads/kit.ts) already holds. */
export async function readPrincipal(core: SignedCore & Pick<BatonCore, 'admin'>, req: Request): Promise<{ principal: ReadPrincipal; req: Request }> {
  if (req.headers.has('X-Baton-Signed') || req.headers.has('X-Baton-Api-Key')) {
    const admins = await core.admin.adminFingerprints();
    const v = await authenticated(core, req, (fp) => admins.get(fp) ?? core.admin.ownerKey(fp) ?? core.runners.publicKey(fp));
    const role = admins.has(v.cred) ? 'admin' : core.admin.ownerKey(v.cred) ? 'owner' : 'runner';
    return { req: v.req, principal: { kind: 'key', role, cred: v.cred } };
  }
  const cred = req.headers.get('X-Baton-Credential');
  if (cred) return { req, principal: { kind: 'key', role: 'runner', cred } };
  const session = req.headers.get('X-Baton-Session');
  if (session == null) throw new BatonError('unauthenticated', 'no principal');
  const fp = await core.admin.session(session);
  if (!fp) throw new BatonError('unauthenticated', 'the dashboard session ended or is unknown');
  return { req, principal: { kind: 'session', role: 'administrator', id: fp, repositories: null } };
}


export async function personPrincipal(core: SignedCore & Pick<BatonCore, 'admin'>, req: Request, breakGlass?: ReadonlyMap<string, string>) {
  const apiKey = req.headers.get('X-Baton-Api-Key');
  if (!req.headers.has('X-Baton-Signed') && apiKey == null) throw new BatonError('unauthenticated', 'sign with an administrator or owner key, or send its API key');
  const admins = await core.admin.adminFingerprints();
  const lookup = (fp: string) => admins.get(fp) ?? core.admin.ownerKey(fp) ?? (apiKey == null ? breakGlass?.get(fp) ?? null : null);
  // R-BTN-159: a person's API key, checked against its public line, in place of a signature.
  const signed = await authenticated(core, req, lookup);
  return { ...signed, administrator: admins.has(signed.cred), breakGlass: apiKey == null && !!breakGlass?.has(signed.cred) };
}

export type PersonPrincipal = Awaited<ReturnType<typeof personPrincipal>>;

export async function dashboardPrincipal(admin: Pick<BatonCore['admin'], 'session' | 'adminFingerprints'>, req: Request): Promise<string> {
  // Access alone serves only while no administrator key is configured (R-BTN-57).
  let owner = await admin.session(req.headers.get('X-Baton-Session'));
  if (!owner && !(await admin.adminFingerprints()).size) owner = req.headers.get('X-Baton-Owner');
  if (!owner) throw new BatonError('unauthenticated', 'the dashboard session ended or is unknown');
  return owner;
}

/** R-BTN-185 (B-145): the host's BATON_HUMAN_KEYS lines — the deployment's root of trust, read
 *  on every call like BATON_ADMIN_KEYS, with each key's stored line (type and base64 alone). */
function humanKeyLines(ports: Pick<Ports, 'humanKeys' | 'config'>): string[] {
  return ports.humanKeys ? ports.humanKeys.list() : parseAdminKeys(ports.config.BATON_HUMAN_KEYS ?? '');
}

export async function humanBreakGlass(ports: Pick<Ports, 'humanKeys' | 'config'>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const line of humanKeyLines(ports)) {
    try {
      const k = await parseSshKey(line);
      out.set(k.fingerprint, `${k.type} ${line.trim().split(/\s+/)[1]}`);
    } catch {
      // a line that is no key admits nobody
    }
  }
  return out;
}
