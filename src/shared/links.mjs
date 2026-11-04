// links.mjs — R-BTN-92's one link rule (BATON_SPEC §3.1; B-54): every link Baton accepts or draws
// for a repository is built from, and checked against, the repository's `web_base`. The rule
// lives in the shared library because the renderers check a view's `link` fields with it
// (R-BTN-112) beside core's registry and blocks — no two parts of Baton disagree on what a link
// is. Core keeps the forge registry's uses of it (src/core/links.ts): paths, pull-request
// shapes, transcript repositories.

/** A parsed `https` URL with no userinfo, query or fragment, whose path segments are clean; or null. */
export function cleanUrl(text, allowQuery) {
  // No whitespace, backslash or control character: the parser strips some, so the stored text would
  // not be the URL checked (round 3, 3-A-0).
  if (text.length > 1000 || /[\\\s\u0000-\u001f\u007f]/.test(text)) return null;
  // As written: `https://` itself (the parser also takes `https:host` and `https:/host`), no
  // fragment marker, and no query marker where none is allowed — not even an empty one (round 2, 2-A-1).
  if (!text.startsWith('https://') || text.includes('#') || (!allowQuery && text.includes('?'))) return null;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash) return null;
  if (!allowQuery && u.search) return null;
  // Percent-decoded, every segment is a name: no `.`, `..`, empty segment or encoded `/` or `\`.
  // Judged on the text as written — the URL parser has already resolved dot segments away, and the
  // text, not the parse, is what is stored and drawn (round 1, 1-A-4, 1-B-1).
  const written = /^https:\/\/[^/?#]*(\/[^?#]*)?/i.exec(text)?.[1] ?? '';
  const raw = written.split('/').slice(1);
  for (const seg of raw) {
    let dec;
    try {
      dec = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (dec === '' || dec === '.' || dec === '..' || /[/\\]/.test(dec)) return null;
  }
  return u;
}

/** R-BTN-92's rule: `url` is under `webBase` — `https`, no userinfo, the same host (case-insensitive)
 *  and port, and a path that begins with the `web_base`'s segments as whole segments, every segment
 *  clean after percent-decoding. */
export function underWebBase(url, webBase) {
  const u = cleanUrl(url, true);
  const b = cleanUrl(webBase, false);
  if (!u || !b) return false;
  if (u.hostname.toLowerCase() !== b.hostname.toLowerCase() || u.port !== b.port) return false;
  const us = u.pathname.split('/').slice(1).map((s) => s.toLowerCase());
  const bs = b.pathname.split('/').slice(1).map((s) => s.toLowerCase());
  return bs.length <= us.length && bs.every((s, i) => us[i] === s);
}
