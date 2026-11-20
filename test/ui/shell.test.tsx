// shell.test.tsx — the shell's frame and sign-in (B-206), and its theme and drawer (B-221):
// a one-time link's token signs in and lands on `/`; a read answering `unauthenticated` draws
// the sign-in in place and keeps the URL, and the screen continues once a session stands; the
// sidebar draws the brand, the repository's screens with `repo.list`'s counts, and the tenant
// screens by the session's role; logout posts `ui.logout` and returns to the sign-in; the theme
// override round-trips through `localStorage`; the drawer opens from the top bar.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { THEME_KEY } from '../../src/dashboard/app/theme';
import { tokenOf } from '../../src/dashboard/app/SignIn';
import { mockFetch, refuse, renderApp, repoList, repoRow, resetShell } from './helpers';

const TOKEN = 'ab'.repeat(32);

afterEach(() => {
  cleanup();
  resetShell();
});

/** A Baton with one session: signed out until `POST /v1/login`, then answering. */
function baton(signedIn: boolean) {
  const state = { signedIn };
  const gate = <T,>(body: T) => () => (state.signedIn ? { body } : refuse('unauthenticated', 'the dashboard session ended or is unknown'));
  const mock = mockFetch({
    'POST /v1/login': (call) => {
      if ((call.body as { token?: string }).token !== TOKEN) return refuse('unauthenticated', 'the link is used, expired or unknown');
      state.signedIn = true;
      return { body: { ok: true } };
    },
    'POST /v1/ui/logout': () => {
      state.signedIn = false;
      return { body: { ok: true } };
    },
    '/v1/ui/session': gate({ ok: true }),
    '/v1/repositories': gate(repoList([repoRow('docs', { needs_you: 2, ready: 5, running: 1, runners_alive: 3, runners_total: 4, discrepancies_7d: 6 }), repoRow('ops')])),
    '/v1/actions': gate({ actions: [] }),
  });
  return { ...mock, state };
}

describe('sign-in (B-206 item 4)', () => {
  it('reads the link’s token from the fragment only', () => {
    expect(tokenOf(`#${TOKEN}`)).toBe(TOKEN);
    expect([tokenOf(''), tokenOf('#abc'), tokenOf(`#${TOKEN}x`), tokenOf(`#${TOKEN.toUpperCase()}`)]).toEqual([null, null, null, null]);
  });

  it('a link token signs in, leaves the address bar, and lands on /', async () => {
    const { calls } = baton(false);
    renderApp(`/login#${TOKEN}`);
    expect(window.location.hash).toBe(''); // gone before the request is answered
    expect(await screen.findByRole('heading', { name: 'Repositories' })).toBeDefined();
    expect(window.location.pathname).toBe('/');
    const login = calls.find((c) => c.path === '/v1/login')!;
    expect([login.method, login.body, login.headers['content-type']]).toEqual(['POST', { token: TOKEN }, 'application/json']);
    expect(screen.getByRole('link', { name: 'docs' })).toBeDefined();
  });

  it('a link that does not sign in says so, with the one CLI line', async () => {
    baton(false);
    renderApp(`/login#${'cd'.repeat(32)}`);
    expect((await screen.findByRole('alert')).textContent).toBe('The link did not sign in: unauthenticated — the link is used, expired or unknown');
    expect(screen.getByText('baton admin open')).toBeDefined();
    expect(window.location.pathname).toBe('/login');
  });

  it('/login without a token names the CLI line; no owner button is drawn; ?as=owner says what is not built', async () => {
    baton(false);
    const plain = renderApp('/login');
    expect(await screen.findByRole('heading', { name: 'Sign in as an administrator' })).toBeDefined();
    expect(screen.getByText('baton admin open')).toBeDefined();
    expect(screen.queryByText(/owner/i)).toBeNull();
    plain.unmount();
    renderApp('/login?as=owner');
    expect(await screen.findByText(/Signing in as an owner is not built yet/)).toBeDefined();
    expect(screen.getByText('B-76')).toBeDefined();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['I have signed in — continue']);
  });

  it('/login with a session standing goes to /', async () => {
    baton(true);
    renderApp('/login');
    expect(await screen.findByRole('heading', { name: 'Repositories' })).toBeDefined();
    expect(window.location.pathname).toBe('/');
  });

  it('an unauthenticated read draws the sign-in in place, keeps the URL, and continues there', async () => {
    const { state } = baton(false);
    renderApp('/repositories/docs/conditions');
    expect(await screen.findByRole('heading', { name: 'Sign in to Baton' })).toBeDefined();
    expect(screen.getByText(/this page continues where it is/)).toBeDefined();
    expect(window.location.pathname).toBe('/repositories/docs/conditions'); // no redirect, no return URL
    expect(window.location.search).toBe('');

    // Not signed in yet: the button says so and stays.
    fireEvent.click(screen.getByRole('button', { name: 'I have signed in — continue' }));
    expect(await screen.findByText(/No session yet/)).toBeDefined();

    // The link was opened in another tab: this one continues where it was.
    state.signedIn = true;
    fireEvent.click(screen.getByRole('button', { name: 'I have signed in — continue' }));
    expect(await screen.findByRole('navigation', { name: 'Repository overview' })).toBeDefined();
    expect(window.location.pathname).toBe('/repositories/docs/conditions');
  });

  it('a session that ends mid-way draws the sign-in in place', async () => {
    const { state } = baton(true);
    const { store } = renderApp('/repositories/docs/board');
    await screen.findByRole('navigation', { name: 'Repository overview' });
    state.signedIn = false;
    await act(() => store.refresh());
    expect(await screen.findByRole('heading', { name: 'Sign in to Baton' })).toBeDefined();
    expect(window.location.pathname).toBe('/repositories/docs/board');
  });
});

describe('the frame (B-206 item 1)', () => {
  it('draws the brand and origin, the repository’s screens with repo.list’s counts, and the freshness line', async () => {
    baton(true);
    // The Goals screen makes no read of its own (B-198: goals are B-122's), so the freshness
    // line below is the shell's reads alone, whatever the entity screens fetch.
    renderApp('/repositories/docs/goals');
    const nav = await screen.findByRole('navigation', { name: 'Screens' });
    await within(nav).findByRole('link', { name: /^Board/ });
    expect(screen.getByText(window.location.host)).toBeDefined();
    const text = (name: RegExp) => within(nav).getByRole('link', { name }).textContent;
    expect(text(/^Tickets/)).toBe('Tickets5 · 1');
    expect(text(/^Runners/)).toBe('Runners3/4');
    expect(text(/^Conditions/)).toBe('Conditions2');
    expect(text(/^Sync ?6/)).toBe('Sync6');
    for (const label of ['Goals', 'Courses', 'Grants', 'Owners', 'Tokens', 'MCP keys', 'Sync keys', 'Check-runners', 'Policy', 'Settings', 'Bars', 'Consents', 'Attestations']) {
      expect(within(nav).getByRole('link', { name: label })).toBeDefined();
    }
    expect(within(nav).getByRole('link', { name: 'Goals' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText(/Live · updated/)).toBeDefined();
    expect(screen.getByText('Polls every 10 s')).toBeDefined();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('logout posts ui.logout, forgets the session and returns to the sign-in', async () => {
    const { calls, state } = baton(true);
    renderApp('/repositories/docs/board');
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to Baton' })).toBeDefined();
    const out = calls.find((c) => c.path === '/v1/ui/logout')!;
    expect([out.method, out.body, out.headers['content-type']]).toEqual(['POST', {}, 'application/json']);
    expect(state.signedIn).toBe(false);
    expect(window.location.pathname).toBe('/login');
  });
});

describe('theme and drawer (B-221 item 4)', () => {
  it('the theme override round-trips: system, light, dark — the only thing in localStorage', async () => {
    baton(true);
    const first = renderApp('/');
    const dark = await screen.findByRole('radio', { name: 'dark' });
    expect((screen.getByRole('radio', { name: 'system' }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    fireEvent.click(dark);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(window.localStorage.length).toBe(1);
    // A reload keeps it.
    first.unmount();
    document.documentElement.removeAttribute('data-theme');
    renderApp('/');
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
    expect((await screen.findByRole('radio', { name: 'dark' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'light' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('radio', { name: 'system' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it('the drawer opens from the top bar, and closes on Escape and on navigation', async () => {
    baton(true);
    const { container } = renderApp('/repositories/docs/board');
    const menu = await screen.findByRole('button', { name: 'Menu' });
    const side = container.querySelector('#side')!;
    expect(menu.getAttribute('aria-controls')).toBe('side');
    expect([menu.getAttribute('aria-expanded'), side.classList.contains('open')]).toEqual(['false', false]);
    fireEvent.click(menu);
    expect([menu.getAttribute('aria-expanded'), side.classList.contains('open')]).toEqual(['true', true]);
    fireEvent.keyDown(side, { key: 'Escape' });
    expect(side.classList.contains('open')).toBe(false);
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('link', { name: /^Tickets/ }));
    expect(window.location.pathname).toBe('/repositories/docs/tickets');
    expect(side.classList.contains('open')).toBe(false);
  });
});
