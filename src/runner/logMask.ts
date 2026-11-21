import { BEARER_TOKEN, KEY_BEGIN, KEY_END, KEY_HOLD } from '../shared/mask.mjs';

const keyOpen = '-----BEGIN ';
const keyClose = '-----END ';
const bearerPrefix = new RegExp(`^${BEARER_TOKEN.source}`);
const word = /[A-Za-z0-9_]/;
const token = /[A-Za-z0-9_-]/;
const label = /[A-Z0-9 ]/;

/** S-BTN-98: mark matches against the original stream, including matches starting inside
 * another redaction. Retain only undecided lookahead, never a line or a key body. */
export function logMask(secrets: readonly string[]) {
  const literals = new Map<string, string[]>();
  for (const secret of secrets) {
    if (!secret) continue;
    const group = literals.get(secret[0]) ?? [];
    group.push(secret);
    literals.set(secret[0], group);
  }
  let tail = '';
  let covered = 0;
  let redacted = false;
  let previous = '';
  let bearer = false;
  let key = false;

  return (input: string, eof = false): string => {
    const text = tail + input;
    let out = '';
    let i = 0;
    scan: for (; i < text.length;) {
      const c = text[i];
      let match = 0;
      for (const literal of literals.get(c) ?? []) {
        if (text.startsWith(literal, i)) match = Math.max(match, literal.length);
        else if (i + literal.length > text.length && literal.startsWith(text.slice(i))) {
          if (!eof) break scan;
        }
      }

      let banner = 0;
      const prefix = key ? keyClose : keyOpen;
      if (c === '-') {
        if (text.startsWith(prefix, i)) {
          let j = i + prefix.length;
          while (j < text.length && j - i < KEY_HOLD && label.test(text[j])) j++;
          if (j - i >= KEY_HOLD && !key) {
            // An oversized ambiguous header fails closed without buffering its body.
            key = true;
          } else {
            const candidate = text.slice(i, j + 5);
            if ((key ? KEY_END : KEY_BEGIN).test(candidate)) banner = candidate.length;
            else if (j - i < KEY_HOLD && j + 5 > text.length && /^-{0,4}$/.test(text.slice(j))) {
              if (!eof) break;
              if (!key) match = Math.max(match, text.length - i);
            }
          }
        } else if (!eof && i + prefix.length > text.length && prefix.startsWith(text.slice(i))) break;
      }

      const wasKey = key;
      if (!bearer && c === 'b' && !word.test(previous)) {
        if (!eof && i + 5 > text.length) break;
        bearer = bearerPrefix.test(text.slice(i, i + 5));
      } else if (bearer && !token.test(c)) bearer = false;
      if (banner) key = !key;
      covered = Math.max(covered, match, banner);
      const hidden = wasKey || key || bearer || covered > 0;
      if (hidden) { if (!redacted) out += '***'; }
      else out += c;
      redacted = hidden;
      covered = Math.max(0, covered - 1);
      previous = c;
      i++;
    }
    // Do not return half a UTF-16 surrogate pair: the decoder handed us complete characters,
    // and a pair cannot be split by valid environment literals or ASCII pattern markers.
    tail = text.slice(i);
    return out;
  };
}
