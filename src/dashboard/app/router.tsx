// router.tsx — the client's router (B-221), generated from `src/core/screens.ts`: the one table
// the front serves the shell by and `ui.view` names screens by, imported into the bundle as
// data. No second list of paths lives here and no router library. The URL is matched against
// the table and nothing else is read from it; navigation is `history.pushState`, so back,
// forward and reload land on the same screen (the front serves the shell at every screen path).
import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { ID_SEGMENT, SCREENS, type Screen } from '../../core/screens';

/** A URL matched to its screen: the table's entry and the `{param}` segments' values. */
export interface Route {
  screen: Screen;
  params: Record<string, string>;
}

const TABLE = SCREENS.map((screen) => ({ screen, segments: screen.path.split('/') }));

/** The screen `pathname` names, or null: every literal segment itself, every `{param}` one
 *  id-shaped segment — `isScreenPath`'s rule, with the parameters kept. */
export function matchScreen(pathname: string): Route | null {
  const parts = pathname.split('/');
  for (const { screen, segments } of TABLE) {
    if (segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const hit = segments.every((seg, i) => {
      if (!seg.startsWith('{')) return seg === parts[i];
      if (!ID_SEGMENT.test(parts[i])) return false;
      params[seg.slice(1, -1)] = parts[i];
      return true;
    });
    if (hit) return { screen, params };
  }
  return null;
}

/** A screen's URL: its `path` with each `{param}` filled. Throws on an unknown screen id or a
 *  parameter that is missing or not id-shaped — a link the page must not draw. */
export function pathOf(screenId: string, params: Record<string, string> = {}): string {
  const screen = SCREENS.find((s) => s.id === screenId);
  if (!screen) throw new Error(`no screen ${screenId} in screens.ts`);
  return screen.path.split('/').map((seg) => {
    if (!seg.startsWith('{')) return seg;
    const value = params[seg.slice(1, -1)];
    if (typeof value !== 'string' || !ID_SEGMENT.test(value)) throw new Error(`screen ${screenId} needs an id-shaped ${seg}`);
    return value;
  }).join('/');
}

/** `pathOf`, or null where the parameters do not fit — for a link built from a read's value,
 *  which is then drawn as text. */
export function pathOrNull(screenId: string, params: Record<string, string> = {}): string | null {
  try {
    return pathOf(screenId, params);
  } catch {
    return null;
  }
}

/** Go to `to` (a path on this origin, with an optional query): a history entry, or `replace`. */
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (!to.startsWith('/') || to.startsWith('//')) return; // this origin only: no open redirect
  if (opts.replace) window.history.replaceState(null, '', to);
  else if (to !== window.location.pathname + window.location.search) window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};

/** The page's current pathname, following back, forward and `navigate`. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/');
}

/** The page's current query string (`?a=b`, or empty), following the same events. */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search, () => '');
}

/** A link to another screen of this app: a real `<a href>` (open in a new tab works), a plain
 *  click navigates in place. `to` is a path — build it with `pathOf`. */
export function Link({ to, children, className, current, title }: { to: string; children: ReactNode; className?: string; current?: boolean; title?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} className={className} title={title} aria-current={current ? 'page' : undefined} onClick={onClick}>
      {children}
    </a>
  );
}
