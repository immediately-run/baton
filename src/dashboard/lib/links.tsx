// links.tsx — the client's link rule (§12.3): a link built from a read's value is drawn as a
// link only when it passes the same rule the server applies — R-BTN-92's `web_base` rule and
// R-BTN-157's `link_hosts` through the shared library's `viewLink`, R-BTN-113's `session_hosts`
// through the core's own `sessionLinkWhy` — with the allow-lists `repo.list` carries. Anything
// else is drawn as text. The page never decides a host is safe by itself.
import { createContext, useContext, type ReactNode } from 'react';
import { cleanUrl } from '../../shared/links.mjs';
import { viewLink } from '../../shared/view.mjs';
import { sessionLinkWhy } from '../../core/links';
import { textOf } from './Text';

/** What links a screen may draw: the caller's repositories' `web_base`s and the instance's two
 *  host lists, all from `GET /v1/repositories`. */
export interface LinkContext {
  webBases: string[];
  linkHosts: string[];
  sessionHosts: string[];
}

export const NO_LINKS: LinkContext = { webBases: [], linkHosts: [], sessionHosts: [] };

const Ctx = createContext<LinkContext>(NO_LINKS);

export function LinkProvider({ value, children }: { value: LinkContext; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLinkContext = (): LinkContext => useContext(Ctx);

/** Which rule a link answers: `link` — under a `web_base`, or its host on `link_hosts`;
 *  `session` — a leg run's session link, its host on `session_hosts`. */
export type LinkKind = 'link' | 'session';

/** The URL as a link the page may draw, or null — then it is text. */
export function safeHref(url: unknown, ctx: LinkContext, kind: LinkKind = 'link'): string | null {
  if (typeof url !== 'string' || url === '') return null;
  // The server's own rule, and the text as written: `https://` itself, no whitespace, backslash
  // or control character a second parser could read differently.
  if (kind === 'session') return url.startsWith('https://') && !/[\\\s\u0000-\u001f\u007f]/.test(url) && sessionLinkWhy(url, ctx.sessionHosts.map((h) => h.toLowerCase())) === null ? url : null;
  return viewLink(url, { webBases: ctx.webBases, linkHosts: ctx.linkHosts });
}

/** A repository's page on its forge (R-BTN-92): its `web_base` itself, when it is a clean
 *  `https` URL; a `git` repository has none. */
export function forgeHref(webBase: unknown): string | null {
  return typeof webBase === 'string' && cleanUrl(webBase, false) !== null ? webBase : null;
}

/** The host a link leads to, shown beside it so a reader sees where it goes. */
export function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return '';
  }
}

/** A link to another origin, drawn only when it passes the rule; otherwise its text alone.
 *  `children` default to the URL as text. Always a new tab, never an opener. */
export function ExtLink({ href, kind, children, showHost }: { href: unknown; kind?: LinkKind; children?: ReactNode; showHost?: boolean }) {
  const ctx = useLinkContext();
  const safe = safeHref(href, ctx, kind);
  const label = children ?? textOf(href);
  if (safe === null) return <span className="unlinked">{label}</span>;
  return (
    <a className="ext" href={safe} target="_blank" rel="noopener noreferrer">
      {label}
      {showHost ? <span className="ext-host"> ({hostOf(safe)})</span> : null}
    </a>
  );
}
