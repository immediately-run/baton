// Types for links.mjs (R-BTN-92): the repository type-checks TypeScript only (allowJs off).
/** A parsed `https` URL with no userinfo, query or fragment, whose path segments are clean; or null. */
export function cleanUrl(text: string, allowQuery: boolean): URL | null;
/** R-BTN-92's rule: `url` is under `webBase` — `https`, no userinfo, the same host and port, and a
 *  path that begins with the `web_base`'s segments as whole segments. */
export function underWebBase(url: string, webBase: string): boolean;
