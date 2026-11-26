// helpers.tsx — what a `test/ui` test stands a screen on: a mocked `fetch` answering the reads
// by path, and a shell around the component under test — the polling store, the session's
// entries and `repo.list` — so a screen is rendered exactly as the app mounts it, with no
// server. Nothing here reaches a network: the client speaks HTTP only, and these tests never do.
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../../src/dashboard/app/App';
import { ShellContext } from '../../src/dashboard/app/shell';
import { LinkProvider } from '../../src/dashboard/lib/links';
import { ReadStore, ReadsProvider } from '../../src/dashboard/lib/reads';
import { asRepoList, type Action, type RepoList, type RepoRow } from '../../src/dashboard/lib/types';
import { ClockProvider } from '../../src/dashboard/lib/ui';
import { resetSchemaCache } from '../../src/dashboard/lib/View';

/** One request as the mock saw it. */
export interface Call {
  method: string;
  /** Path and query. */
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** What a route answers: a status, a JSON body, an ETag. */
export interface Answer {
  status?: number;
  body?: unknown;
  etag?: string;
}

/** A route: a JSON body (answered `200`), or a function of the call. */
export type Route = ((call: Call) => Answer | Promise<Answer>) | object;

/** `{status, body}` for a refusal in §14's shape. */
export const refuse = (code: string, message = code, status = { unauthenticated: 401, forbidden: 403, 'not-found': 404, 'invalid-params': 400, conflict: 409 }[code] ?? 400): Answer =>
  ({ status, body: { ok: false, code, message } });

/** Replace `fetch`: `routes` are keyed `'GET /v1/…'` (or the bare path, a `GET`), query
 *  included where the test cares, else matched without it. An unknown route answers
 *  `not-found`. A `GET` whose answer carries an `etag` the request already holds
 *  (`If-None-Match`) is answered `304`. Returns the calls made, in order. */
export function mockFetch(routes: Record<string, Route>): { calls: Call[]; routes: Record<string, Route> } {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const call: Call = { method, path: url.pathname + url.search, headers, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const keys = [`${method} ${call.path}`, `${method} ${url.pathname}`, ...(method === 'GET' ? [call.path, url.pathname] : [])];
    const key = keys.find((k) => k in routes);
    const route = key === undefined ? () => refuse('not-found', 'no such route') : routes[key];
    const answer: Answer = typeof route === 'function' ? await (route as (c: Call) => Answer | Promise<Answer>)(call) : { body: route };
    const status = answer.status ?? 200;
    if (method === 'GET' && status === 200 && answer.etag && headers['if-none-match'] === answer.etag) return new Response(null, { status: 304, headers: { ETag: answer.etag } });
    return new Response(status === 204 || status === 304 ? null : JSON.stringify(answer.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json', ...(answer.etag ? { ETag: answer.etag } : {}) },
    });
  };
  vi.stubGlobal('fetch', vi.fn(impl));
  return { calls, routes };
}

/** A `repo.list` row with every count, for a fixture. */
export function repoRow(id: string, over: Partial<RepoRow> = {}): RepoRow {
  return {
    id, github: `example-org/${id}`, forge: 'github', web_base: `https://github.com/example-org/${id}`, default_branch: 'main', weight: 1,
    courses: [{ id: 'course-a', version: 3 }], head: { sha: 'cabec94c0123456789abcdef0123456789abcdef', received_at: Date.now() - 60_000, observation: 7 },
    mode: 'cut-over', running: 2, ready: 5, needs_you: 0, runners_alive: 3, runners_total: 4, discrepancies_7d: 1, exclusive_goal: null, ...over,
  };
}

/** A `GET /v1/repositories` answer. */
export function repoList(rows: RepoRow[], role: 'administrator' | 'owner' | null = 'administrator', over: Partial<RepoList> = {}): RepoList {
  return { repositories: rows, session: role ? { role } : null, link_hosts: [], session_hosts: ['claude.ai'], ...over };
}

/** Put the page at `path` (and fragment) before the app mounts. */
export function goTo(path: string) {
  window.history.replaceState(null, '', path);
}

/** The whole app at `path`, over the mocked `fetch`. */
export function renderApp(path: string): RenderResult & { store: ReadStore } {
  goTo(path);
  const store = new ReadStore();
  return Object.assign(render(<App store={store} />), { store });
}

export interface ShellFixture {
  actions?: Action[];
  repos?: RepoList;
  store?: ReadStore;
  now?: number;
}

/** One screen or component inside the shell's providers, without the frame: the store its
 *  `useRead`s poll through (over the mocked `fetch`), the session's entries for `Controls`,
 *  `repo.list` and the link rule's hosts. */
export function renderWithShell(ui: ReactElement, fixture: ShellFixture = {}): RenderResult & { store: ReadStore } {
  const store = fixture.store ?? new ReadStore();
  const repos = fixture.repos ?? asRepoList(null);
  const wrap = ({ children }: { children: ReactNode }) => (
    <ReadsProvider store={store}>
      <ShellContext.Provider value={{ actions: fixture.actions ?? [], repos, role: repos.session?.role ?? null }}>
        <LinkProvider value={{ webBases: repos.repositories.map((r) => r.web_base).filter((b): b is string => typeof b === 'string'), linkHosts: repos.link_hosts, sessionHosts: repos.session_hosts }}>
          <ClockProvider now={fixture.now ?? Date.now()}>{children}</ClockProvider>
        </LinkProvider>
      </ShellContext.Provider>
    </ReadsProvider>
  );
  return Object.assign(render(ui, { wrapper: wrap }), { store });
}

/** Between tests: the real `fetch`, an empty schema cache, the root URL, no stored theme. */
export function resetShell() {
  vi.unstubAllGlobals();
  resetSchemaCache();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
}
