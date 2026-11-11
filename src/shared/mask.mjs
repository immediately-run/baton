// mask.mjs — the one list of what a leg's output may not carry (BATON_SPEC §8.4 R-BTN-144),
// shared by the runner and the archiver: the class-5 bearer prefixes every Baton credential
// starts with, and the class-6 private key block. One definition, so the runner's output stream
// and an archiver's transcripts mask the same spellings — a prefix added here is added to both.
//
// The prefixes: `brt_`, `bak_` and `bmcp_` for a runner, an API key and an MCP key (§12.1), and
// `bps_` (the pending sign-in cookie's value) and `bds_` (a dashboard session), `bmo_` (an OAuth
// client), `bmr_` (an OAuth refresh token) and `bor_` (an OAuth resource token) for the
// dashboard and `BATON_MCP_OAUTH_SPEC` §12. Each is followed by the credential's own characters,
// never a word character before it: a prefix inside a longer word (`xbps_…`) starts no
// credential.

/** R-BTN-144 class 5: every bearer prefix Baton issues, followed by `[A-Za-z0-9_-]*`. */
export const BEARER_TOKEN = /(?<![A-Za-z0-9_])(brt|bak|bmcp|bps|bds|bmo|bmr|bor)_[A-Za-z0-9_-]*/g;

/** R-BTN-144 class 6: a `-----BEGIN … PRIVATE KEY-----` … `-----END … -----` block, replaced
 *  whole — after a `BEGIN` line, held until the `END` line or 16 KB, a block never closed for
 *  the rest of the string. */
export const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*-----|$)/g;

/** `text`, with every class-5 and class-6 occurrence replaced by `***`. */
export function maskSecrets(text) {
  return text.replace(PRIVATE_KEY_BLOCK, '***').replace(BEARER_TOKEN, '***');
}
