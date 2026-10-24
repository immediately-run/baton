// sign.mjs — a request signed by an SSH key, as Baton's one verifier checks it (BATON_SPEC §10.1
// R-BTN-13 as amended; §10.6): an RFC 9421 `Signature-Input` and `Signature` over `@method`,
// `@authority`, `@path`, `@query` and `content-digest`, whose value is an SSHSIG in the namespace
// `baton-request`, made by `ssh-keygen -Y sign`. The key is the file `-i` names — an administrator's
// or an owner's key, kept out of every agent's ssh-agent (R-BTN-57) — or a public key whose private
// half ssh-agent holds. The private key never reaches stdout, stderr or an argument list.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

export const NAMESPACE = 'baton-request';

/** How long ssh-keygen may take before the call fails (§6.3's bound; B-88). */
export const KEYGEN_TIMEOUT_MS = 30_000;

/** How the key is run: the program (a test's stand-in by PATH) and the bound. */
const KEYGEN = { command: 'ssh-keygen', timeout: KEYGEN_TIMEOUT_MS };

/** ssh-keygen's own options for one call, over the caller's. */
const run = (args, options, { command, timeout }) =>
  spawnSync(command, args, { encoding: 'utf8', ...options, timeout, killSignal: 'SIGKILL' });

/** The lines of ssh-keygen's own answer, without a banner. A fault — a private key another user
 *  can read, a file with no private half — opens with ssh-keygen's `@@@@…` warning box and the
 *  reason comes after it; the first line is a banner, never the fault. */
function reason(r) {
  const lines = (r.stderr || '').split(/\r?\n/).map((l) => l.trim());
  const i = lines.findIndex((l) => l && !l.startsWith('@'));
  return i === -1 ? (r.error?.code ?? '') : lines.slice(i).join(' ');
}

/** The key at `file`: `{file, fingerprint}`, or throws. Bounded like every git and forge call:
 * a key on a stalled mount or behind a busy agent fails the call, it never waits for ever.
 * `-y` rather than `-l` reads the private half: `-l` answers from a `.pub` alone, and the error
 * names a private key ssh-keygen will not sign with — a `.pub` with no private half beside it,
 * one another user can read — before the first signature instead of at it. */
export function signingKey(file, keygen = KEYGEN) {
  const probe = run(['-y', '-f', file], {}, keygen);
  // Its fingerprint is `-l`'s, the one `repo add --sync-key` registers; `-y` answers only that
  // ssh-keygen would sign with it.
  const listing = probe.status === 0 ? run(['-l', '-E', 'sha256', '-f', file], {}, keygen).stdout : '';
  const fingerprint = /\b(SHA256:[A-Za-z0-9+/]{43})\b/.exec(listing)?.[1] ?? null;
  if (!fingerprint) throw new Error(`${file} is not an SSH private key ssh-keygen can sign with${reason(probe) ? ` (${reason(probe)})` : ''}`);
  return { file, fingerprint };
}

/** `Content-Digest` (RFC 9530): sha-256 of the body. */
export function contentDigest(body = '') {
  return `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;
}

/** The RFC 9421 signature base Baton rebuilds. */
export function signatureBase({ method, url, digest, params }) {
  const u = new URL(url);
  return [
    `"@method": ${method.toUpperCase()}`,
    `"@authority": ${u.host.toLowerCase()}`,
    `"@path": ${u.pathname}`,
    `"@query": ${u.search || '?'}`,
    `"content-digest": ${digest}`,
    `"@signature-params": ${params}`,
  ].join('\n');
}

/** The headers that sign one request with `key`. `now` is epoch milliseconds. */
export function signHeaders({ method, url, body, key, now = Date.now() }, keygen = KEYGEN) {
  const digest = contentDigest(body ?? '');
  const nonce = randomBytes(16).toString('base64url');
  const params = `("@method" "@authority" "@path" "@query" "content-digest");created=${Math.floor(now / 1000)};nonce="${nonce}";keyid="${key.fingerprint}";tag="${NAMESPACE}"`;
  const base = signatureBase({ method, url, digest, params });
  const r = run(['-Y', 'sign', '-f', key.file, '-n', NAMESPACE, '-q'], { input: base }, keygen);
  if (r.status !== 0) throw new Error(`ssh-keygen -Y sign failed (${reason(r)})`);
  const blob = r.stdout.split('\n').filter((l) => l && !l.startsWith('-----')).join('');
  return { 'Content-Digest': digest, 'Signature-Input': `sig1=${params}`, Signature: `sig1=:${blob}:` };
}
