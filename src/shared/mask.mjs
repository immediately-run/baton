// mask.mjs — R-BTN-144 classes 5 and 6: the bearer prefixes every Baton credential starts with,
// and the private key block. One definition, shared by every stream that masks — a prefix added
// here is masked wherever masking runs. Class 7 (the value of a kept variable, by its name) is the
// environment's to compute: `src/runner/mask.ts` finds the values in the environment the runner
// holds and masks them as literals beside this pattern (B-170).
//
// The prefixes: `brt_`, `bak_` and `bmcp_` for a runner, an API key and an MCP key (§12.1), and
// `bps_` (the pending sign-in cookie's value) and `bds_` (a dashboard session), `bmo_` (an OAuth
// client), `bmr_` (an OAuth refresh token) and `bor_` (an OAuth resource token) for the
// dashboard and `BATON_MCP_OAUTH_SPEC` §12. Each is followed by the credential's own characters,
// never a word character before it: a prefix inside a longer word (`xbps_…`) starts no
// credential.

/** R-BTN-144 class 5: every bearer prefix Baton issues, followed by `[A-Za-z0-9_-]*`. */
export const BEARER_TOKEN = /(?<![A-Za-z0-9_])(brt|bak|bmcp|bps|bds|bmo|bmr|bor)_[A-Za-z0-9_-]*/g;

/** R-BTN-144 class 6: the `BEGIN` line that opens a private key block, and the `END` line that
 *  closes it — any banner, so a block whose end names another label (`OPENSSH` for `RSA`) still
 *  ends. */
export const KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
export const KEY_END = /-----END [A-Z0-9 ]*-----/;
/** R-BTN-144 class 6: how much of a block never closed is held before it is masked whole. */
export const KEY_HOLD = 16 * 1024;

/** R-BTN-144 class 6 over one whole string: every line from a `BEGIN` line through the `END`
 *  line that closes it goes, and so does an unclosed block's, to the string's end. Text that is
 *  not key material on the `BEGIN` line itself (`key: …`) stays, with the block masked after it. */
export function maskKeys(text) {
  const lines = text.split('\n');
  let held = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!held) {
      const open = line.search(KEY_BEGIN);
      if (open < 0) continue;
      const before = line.slice(0, open);
      lines[i] = `${before}***`;
      held = !KEY_END.test(line.slice(open));
      continue;
    }
    lines[i] = '***';
    if (KEY_END.test(line)) held = false;
  }
  return lines.join('\n');
}

/** `text`, with every class-5 and class-6 occurrence replaced by `***`. */
export function maskSecrets(text) {
  // A fresh pattern per call, so nothing a previous replacement left in a shared `lastIndex` can
  // move where this one starts.
  const tokens = new RegExp(BEARER_TOKEN.source, 'g');
  return maskKeys(text).replace(tokens, '***');
}

/** R-BTN-144 class 6 across a stream, which a line-at-a-time sink cannot do: from a `BEGIN`
 *  line, lines are held until the `END` line or `KEY_HOLD` bytes, and the run is masked whole
 *  then — a key printed over several lines never leaves piece by piece. `push` takes one line
 *  (the sink's unit) and returns the lines that may leave now, joined by `\n` (`''` while a
 *  block is held); `flush` returns `***` for a block the stream ended inside of. Class 5 is
 *  masked on every line as it leaves, and a token never spans a line. */
export function createMasker() {
  const out = [];
  let held = false;
  let bytes = 0;
  const release = () => {
    out.push('***');
    held = false;
    bytes = 0;
  };
  return {
    push(line) {
      if (held) {
        bytes += line.length + 1;
        if (KEY_END.test(line) || bytes >= KEY_HOLD) release();
      } else {
        const open = line.search(KEY_BEGIN);
        if (open < 0) out.push(maskSecrets(line));
        else {
          // What is not key material on the `BEGIN` line (`key: …`) leaves with it, and the
          // block holds from that line on, never answered now.
          if (open > 0) out.push(maskSecrets(line.slice(0, open)).replace(/\s+$/, ''));
          held = true;
          bytes = line.length;
        }
      }
      return out.length ? out.splice(0).join('\n') : '';
    },
    flush() {
      if (held) release();
      return out.splice(0).join('\n');
    },
  };
}
