// App.tsx — the dashboard's shell (BATON-UI-V2: B-206 the frame and sign-in, B-221 the router,
// the polling layer's wiring, refusals, the drawer): a sidebar and a main column, with the
// screen the URL names mounted inside. The shell reads two things itself — `GET
// /v1/repositories` (the caller's repositories, the session's role, every count the sidebar and
// the strip draw) and `GET /v1/actions` (the session's registry entries, the controls' one
// source) — and nothing else; each screen reads its own entity. Every value from a read reaches
// the page as a text child (§12.3). The shell holds no key: the session cookie is the only
// credential, and `unauthenticated` on any read draws the sign-in in place, the URL kept.
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiSend, asApiError } from '../lib/api';
import { LinkProvider, type LinkContext } from '../lib/links';
import { ReadStore, ReadsProvider, useNow, useRead, useReadStore } from '../lib/reads';
import { asActions, asRepoList } from '../lib/types';
import { ClockProvider, ErrorNote, Loading } from '../lib/ui';
import { resetSchemaCache } from '../lib/View';
import * as BUILT from '../screens';
import type { ScreenComponent } from '../screens/contract';
import { NotBuilt } from './NotBuilt';
import { NoPage, RepositoryRefusal } from './Refusal';
import { ConditionRedirect, conditionAddress } from '../screens/conditions/ConditionRedirect';
import { ShellContext, type ShellState } from './shell';
import { Sidebar } from './Sidebar';
import { SignIn, tokenOf } from './SignIn';
import { Strip } from './Strip';
import { titleOf } from './nav';
import { matchScreen, navigate, usePath, type Route } from './router';

/** The built screens by id — `screens/index.ts`'s exports. */
export const SCREEN_COMPONENTS = BUILT as unknown as Record<string, ScreenComponent | undefined>;

/** `GET /v1/actions` is re-read on sign-in, after every control, and this often (B-221). */
export const ACTIONS_EVERY_MS = 60_000;

/** A screen that throws while drawing takes down itself, not the frame. */
class ScreenBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorNote error={{ code: 'screen-error', message: this.state.error.message }} what="This screen failed to draw" />;
  }
}

function ScreenOutlet({ route, path, state }: { route: Route | null; path: string; state: ShellState }) {
  const { repos, role } = state;
  // B-195: `/conditions/{id}` is no screen — it finds the condition's page in the tree.
  const condition = route ? null : conditionAddress(path);
  if (condition) return <ConditionRedirect key={condition} id={condition} />;
  if (!route) return <NoPage path={path} />;
  // R-BTN-155: an owner's session sees no administrator screen (the server refuses it anyway).
  if (route.screen.role === 'administrator' && role === 'owner') return <NoPage path={path} />;
  const wanted = route.params.repository;
  const row = wanted === undefined ? null : repos.repositories.find((r) => r.id === wanted) ?? null;
  if (wanted !== undefined && !row) return <RepositoryRefusal id={wanted} />;
  const Screen = SCREEN_COMPONENTS[route.screen.id] ?? NotBuilt;
  return (
    <ScreenBoundary key={path}>
      <Screen screen={route.screen} params={route.params} repository={row} repos={repos} role={role} />
    </ScreenBoundary>
  );
}

function SignedIn({ path, onLogout }: { path: string; onLogout: () => void }) {
  const reposRead = useRead('/v1/repositories');
  const actionsRead = useRead('/v1/actions', { every: ACTIONS_EVERY_MS });
  const repos = useMemo(() => (reposRead.data === undefined ? null : asRepoList(reposRead.data)), [reposRead.data]);
  const actions = useMemo(() => asActions(actionsRead.data), [actionsRead.data]);
  const state = useMemo<ShellState | null>(() => (repos ? { actions, repos, role: repos.session?.role ?? null } : null), [actions, repos]);
  const links = useMemo<LinkContext>(() => ({
    webBases: (repos?.repositories ?? []).map((r) => r.web_base).filter((b): b is string => typeof b === 'string' && b !== ''),
    linkHosts: repos?.link_hosts ?? [],
    sessionHosts: repos?.session_hosts ?? [],
  }), [repos]);
  const now = useNow(5000);
  const [drawer, setDrawer] = useState(false);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  const route = path === '/login' ? null : matchScreen(path);

  // `/login` with a session standing: there is nothing to sign in to — the root.
  useEffect(() => {
    if (path === '/login' && repos) navigate('/', { replace: true });
  }, [path, repos]);

  // A new screen: the drawer closes, the page names it, and focus lands on the main column.
  useEffect(() => {
    setDrawer(false);
    document.title = route ? `${titleOf(route.screen.id)} — Baton` : 'Baton';
    if (first.current) first.current = false;
    else main.current?.focus();
  }, [path]); // the route is `path`'s

  const row = route?.params.repository && repos ? repos.repositories.find((r) => r.id === route.params.repository) ?? null : null;
  let body: ReactNode;
  if (path === '/login') body = <Loading what="the session" />;
  else if (!state) body = reposRead.error ? <ErrorNote error={reposRead.error} what="Baton did not answer the repositories read" /> : <Loading />;
  else body = <ScreenOutlet route={route} path={path} state={state} />;

  return (
    <ShellContext.Provider value={state ?? { actions: [], repos: asRepoList(null), role: null }}>
      <LinkProvider value={links}>
        <ClockProvider now={now}>
          <div className="shell" onKeyDown={(e) => e.key === 'Escape' && setDrawer(false)}>
            <Sidebar id="side" open={drawer} route={route} repos={repos} row={row} role={state?.role ?? null} onLogout={onLogout} />
            {drawer ? <div className="side-backdrop" onClick={() => setDrawer(false)} /> : null}
            <div className="col">
              <div className="topbar">
                <button type="button" className="btn drawer-btn" aria-expanded={drawer} aria-controls="side" onClick={() => setDrawer((d) => !d)}>Menu</button>
                <span className="topbar-where">
                  {row ? <><span className="mono">{row.id}</span> · </> : null}
                  {route ? titleOf(route.screen.id) : 'Baton'}
                </span>
              </div>
              {row ? <Strip row={row} /> : null}
              <main ref={main} tabIndex={-1} className="main">{body}</main>
            </div>
          </div>
        </ClockProvider>
      </LinkProvider>
    </ShellContext.Provider>
  );
}

function Shell() {
  const store = useReadStore();
  const path = usePath();
  // A one-time link (`/login#<token>`) is being consumed; a session is assumed until a read says
  // otherwise (`in`); or there is none (`out`) and the sign-in is drawn where the person is.
  const [auth, setAuth] = useState<'signing' | 'in' | 'out'>(() => (window.location.pathname === '/login' && tokenOf(window.location.hash) ? 'signing' : 'in'));
  const [linkError, setLinkError] = useState<ApiError | null>(null);

  useEffect(() => {
    store.onUnauthenticated = () => setAuth('out');
    return () => {
      store.onUnauthenticated = null;
    };
  }, [store]);

  const signedIn = useCallback(() => {
    setLinkError(null);
    setAuth('in');
    if (window.location.pathname === '/login') navigate('/', { replace: true });
    void store.refresh();
  }, [store]);

  // The link's token: taken out of the address bar before anything else, then exchanged for the
  // session cookie (`POST /v1/login {token}`, same-origin JSON — R-BTN-16's login-CSRF rule).
  useEffect(() => {
    const token = window.location.pathname === '/login' ? tokenOf(window.location.hash) : null;
    if (!token) return;
    window.history.replaceState(null, '', '/login');
    apiSend('POST', '/v1/login', { token }).then(signedIn, (e) => {
      setLinkError(asApiError(e));
      setAuth('out');
    });
  }, []); // once: the fragment is gone after it

  const logout = useCallback(() => {
    // `POST /v1/ui/logout` (`ui.logout`): the session's row ends and the cookie is cleared. The
    // page forgets every answer whatever the call says — a session that is already gone is out.
    const done = () => {
      store.reset();
      resetSchemaCache();
      setLinkError(null);
      setAuth('out');
      navigate('/login', { replace: true });
    };
    apiSend('POST', '/v1/ui/logout', {}).then(done, done);
  }, [store]);

  if (auth === 'signing') return <main className="signin"><h1>Baton</h1><Loading what="— signing in" /></main>;
  if (auth === 'out') {
    const as = path === '/login' ? new URLSearchParams(window.location.search).get('as') : null;
    return <SignIn inPlace={path !== '/login'} as={as} error={linkError} onSignedIn={signedIn} />;
  }
  return <SignedIn path={path} onLogout={logout} />;
}

/** The app. A test hands it its own store; the page makes one. */
export function App({ store }: { store?: ReadStore }) {
  const own = useMemo(() => store ?? new ReadStore(), [store]);
  return (
    <ReadsProvider store={own}>
      <Shell />
    </ReadsProvider>
  );
}
