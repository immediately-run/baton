// commitSign.mjs — an owner-signed git commit, verified (B-127, BATON_SPEC §10.1 R-BTN-13 as
// amended; docs/security-model.mdx, mitigation C): a commit made with `gpg.format ssh` carries
// its SSHSIG in the `gpgsig` header, over the commit object without that header, in the
// namespace `git` — distinct from the `baton-request` namespace requests sign in. The sync
// verifies with this to mark what counts (§7.1), and each runner verifies again before it loads
// what the board post names (finding 4: never only the sync that posts it), so the check runs
// wherever the signature is trusted. Node only (the sync and the runners), never core: it runs
// `ssh-keygen` and writes two temp files per call.
//
// The verified statement is narrow on purpose: the commit object `raw` was signed by one of
// `keys` (public OpenSSH key lines) in the namespace `git`. Who may sign — a repository's
// owners, and of those only the keys no agent session holds (B-127 finding 3, B-136's
// human-only register) — is the caller's fact, read from Baton; a key that verifies but is not
// the repository's does not count, and neither does this module say it might.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** How long one `ssh-keygen -Y verify` may take (§6.3's bound, as cli/sign.mjs's). */
export const KEYGEN_TIMEOUT_MS = 30_000;

/** The principal `allowedSigners` writes and every verify passes: an anchor of our own, so no
 *  committer email — which anyone sets, like the author — is ever what a signature is matched
 *  by. The file is written per call from the keys alone. */
export const SIGNERS_PRINCIPAL = 'baton-owner';

/** The allowed_signers file body for `keys`: one line per key, the principal above, the
 *  namespace pinned to `git`. Keys that are not public OpenSSH lines verify nothing. */
export function allowedSigners(keys) {
  const lines = keys.filter((k) => typeof k === 'string' && /^(ssh|sk|ecdsa)-[A-Za-z0-9@.\-]+ [A-Za-z0-9+/=]+/.test(k.trim()));
  return lines.map((k) => `${SIGNERS_PRINCIPAL} namespaces="git" ${k.trim()}`).join('\n') + (lines.length ? '\n' : '');
}

/**
 * The SSHSIG of a raw commit object: the `gpgsig` header's value, its continuation lines (each
 * one leading space) unfolded — the armored blob `ssh-keygen -Y sign` wrote — or null when the
 * commit carries no SSH signature (an unsigned commit, or one signed in another format).
 */
export function commitSignature(raw) {
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') break; // the headers end at the blank line before the message
    if (lines[i].startsWith('gpgsig ')) {
      const sig = [lines[i].slice('gpgsig '.length)];
      for (let j = i + 1; j < lines.length && lines[j].startsWith(' '); j++) sig.push(lines[j].slice(1));
      return sig.join('\n');
    }
  }
  return null;
}

/**
 * What an SSH-signed commit signed: the raw object with the `gpgsig` header and its
 * continuation lines removed — git's own rule (its `remove_signature`), the rest byte for byte.
 * Only the headers are touched: they end at the blank line before the message, so a message
 * body line that begins `gpgsig ` is the owner's words, not a header to strip (round 1: such a
 * commit used to fail verification and read unsigned). A commit with no `gpgsig` header returns
 * unchanged (it carries no SSHSIG).
 */
export function signedPayload(raw) {
  const lines = raw.split('\n');
  const end = lines.indexOf(''); // the headers end at the blank line before the message
  const headerEnd = end < 0 ? lines.length : end;
  const out = [];
  let skipping = false;
  for (const line of lines.slice(0, headerEnd)) {
    if (line.startsWith('gpgsig ')) { skipping = true; continue; }
    if (skipping) {
      if (line.startsWith(' ')) continue;
      skipping = false;
    }
    out.push(line);
  }
  return [...out, ...lines.slice(headerEnd)].join('\n');
}

/** The fingerprint ssh-keygen names in its `Good … signature` line, else null. */
export function verifiedFingerprint(output) {
  return /(SHA256:[A-Za-z0-9+/]{43})/.exec(String(output))?.[1] ?? null;
}

/** One `ssh-keygen -Y verify` call the caller injected: `{status, stdout, stderr}` for the
 *  files and stdin a real call needs — the seam the unit tests stand in for. */
export function sshKeygenVerify({ signers, signature, payload }, keygen) {
  return keygen({ signers, signature, payload });
}

/**
 * Whether the raw commit object `raw` carries a valid SSH signature in the namespace `git` by
 * one of `keys`, and which key: `{key: fingerprint}` or `{}` when the output names none, or
 * null when it does not verify — unsigned, another format, a forged signature, or a key that is
 * not among `keys`. `keygen` (see `sshKeygenVerify`) is injected, so the pure core is testable
 * without ssh-keygen; callers on Node pass `nodeKeygen`. Never throws for a commit that does
 * not verify: null is the answer a caller gates on.
 */
export function verifySignedCommit(raw, keys, keygen) {
  const signers = allowedSigners(keys);
  const signature = commitSignature(raw);
  if (signature == null || !signers) return null;
  const r = sshKeygenVerify({ signers, signature, payload: signedPayload(raw) }, keygen);
  if (r.status !== 0) return null;
  const key = verifiedFingerprint(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return key == null ? {} : { key };
}

/** `sshKeygenVerify` on Node: the signers and the signature as temp files, the payload on
 *  ssh-keygen's stdin, everything of the call bounded (KEYGEN_TIMEOUT_MS) and removed after. */
export function nodeKeygen({ signers, signature, payload }) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-sshsig-'));
  try {
    const signersFile = join(dir, 'allowed_signers');
    const sigFile = join(dir, 'sig.armored');
    writeFileSync(signersFile, signers);
    writeFileSync(sigFile, `${signature}\n`);
    return spawnSync('ssh-keygen', ['-Y', 'verify', '-n', 'git', '-I', SIGNERS_PRINCIPAL, '-f', signersFile, '-s', sigFile], {
      input: payload, encoding: 'utf8', timeout: KEYGEN_TIMEOUT_MS, killSignal: 'SIGKILL',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
