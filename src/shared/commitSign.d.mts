// Types for commitSign.mjs (B-127): the repository type-checks TypeScript only (allowJs off).
/** How long one `ssh-keygen -Y verify` may take. */
export const KEYGEN_TIMEOUT_MS: number;
/** The principal every verify passes — an anchor of our own, never a committer email. */
export const SIGNERS_PRINCIPAL: string;
/** The allowed_signers file body for `keys`; empty when no key is a public OpenSSH line. */
export function allowedSigners(keys: string[]): string;
/** The commit's SSHSIG armor, or null when it carries no SSH signature. */
export function commitSignature(raw: string): string | null;
/** What an SSH-signed commit signed: the raw object minus the `gpgsig` header's lines. */
export function signedPayload(raw: string): string;
/** The fingerprint ssh-keygen names in its `Good … signature` line, else null. */
export function verifiedFingerprint(output: string): string | null;
/** One injected `ssh-keygen -Y verify` call's answer. */
export interface KeygenResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
}
/** What a verify call needs: the allowed_signers body, the signature armor, the signed payload. */
export interface KeygenInput {
  signers: string;
  signature: string;
  payload: string;
}
export function sshKeygenVerify(input: KeygenInput, keygen: (input: KeygenInput) => KeygenResult): KeygenResult;
/** Whether `raw` is signed in the namespace `git` by one of `keys`, and which key; null when not. */
export function verifySignedCommit(raw: string, keys: string[], keygen: (input: KeygenInput) => KeygenResult): { key: string } | {} | null;
/** `sshKeygenVerify` on Node: temp files and stdin, bounded and cleaned up. */
export function nodeKeygen(input: KeygenInput): KeygenResult;
