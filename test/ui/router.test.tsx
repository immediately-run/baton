// router.test.tsx — B-221's router and refusals: generated from `src/core/screens.ts` and from
// nothing else — every entry's path resolves to its screen, an unknown path to none; a screen
// with no component draws "not built yet" inside the frame; an administrator's screen is
// hidden from an owner's session; back lands on the screen it left; a repository `repo.list`
// does not carry draws §11.4's repository refusal, and `ReadGate` the entity's.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { SCREENS, isScreenPath } from '../../src/core/screens';
import { SCREEN_COMPONENTS } from '../../src/dashboard/app/App';
import { NAV_LABEL, REPOSITORY_NAV, TENANT_NAV, navIdOf } from '../../src/dashboard/app/nav';
import { ReadGate, REPOSITORY_REFUSED } from '../../src/dashboard/app/Refusal';
import { matchScreen, navigate, pathOf, pathOrNull } from '../../src/dashboard/app/router';
import { useRead } from '../../src/dashboard/lib/reads';
import { mockFetch, refuse, renderApp, renderWithShell, repoList, repoRow, resetShell } from './helpers';

const PARAMS: Record<string, string> = { repository: 'docs', ticket: 'R3-1', course: 'course-a', condition: '17', runner: '4' };

afterEach(() => {
  cleanup();
  resetShell();
});

const shell = (role: 'administrator' | 'owner' = 'administrator') => mockFetch({
  '/v1/repositories': repoList([repoRow('docs', { needs_you: 2 }), repoRow('ops')], role),
  '/v1/actions': { actions: [] },
});

describe('the router (B-221 item 1)', () => {
  it('resolves every screens.ts path to its screen, and back', () => {
    for (const s of SCREENS) {
      const path = pathOf(s.id, PARAMS);
      expect(isScreenPath(path)).toBe(true);
      const route = matchScreen(path);
      expect(route?.screen.id).toBe(s.id);
      for (const [k, v] of Object.entries(route!.params)) expect(v).toBe(PARAMS[k]);
    }
  });

  it('resolves no unknown path, and no parameter that is not id-shaped', () => {
    for (const p of ['/nowhere', '/repositories/docs', '/repositories/docs/board/extra', '/repositories/docs/tickets/a b', '/repositories/..%2f/board', '/login', '/conditions/7']) expect(matchScreen(p)).toBeNull();
    expect(pathOrNull('repository/tickets/{ticket}', { repository: 'docs', ticket: '../x' })).toBeNull();
    expect(pathOrNull('repository/nowhere', {})).toBeNull();
  });

  it('holds the sidebar’s table to screens.ts: every list-level screen has one entry, every entry a screen', () => {
    const listed = [...REPOSITORY_NAV.flatMap((g) => g.ids), ...TENANT_NAV.ids, 'root'];
    expect([...listed].sort()).toEqual([...new Set(SCREENS.map((s) => navIdOf(s.id)))].sort());
    for (const id of listed) expect(NAV_LABEL[id]).toBeTruthy();
    expect(TENANT_NAV.ids.sort()).toEqual(SCREENS.filter((s) => s.role === 'administrator').map((s) => s.id).sort());
  });

  it('registers only screens of screens.ts', () => {
    for (const id of Object.keys(SCREEN_COMPONENTS)) expect(SCREENS.map((s) => s.id)).toContain(id);
    expect(SCREEN_COMPONENTS.root).toBeTypeOf('function');
  });

  it('draws "not built yet" inside the frame for a screen with no component, naming its path', async () => {
    const pending = SCREENS.find((s) => !SCREEN_COMPONENTS[s.id] && s.id.startsWith('repository/') && !s.id.includes('{', 'repository/'.length));
    if (!pending) return; // every screen is built: nothing left to say
    shell();
    renderApp(pathOf(pending.id, PARAMS));
    expect(await screen.findByRole('heading', { name: 'This screen is not built yet' })).toBeDefined();
    expect(screen.getByText(pending.path)).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Screens' })).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Repository overview' })).toBeDefined();
  });

  it('follows a link, and back and forward land on the screen they left', async () => {
    shell();
    renderApp('/');
    const docs = await screen.findByRole('link', { name: 'docs' });
    fireEvent.click(docs);
    expect(window.location.pathname).toBe('/repositories/docs/board');
    await screen.findByRole('navigation', { name: 'Repository overview' });
    fireEvent.click(screen.getByRole('link', { name: /^Conditions/ }));
    expect(window.location.pathname).toBe('/repositories/docs/conditions');
    expect(screen.getByRole('link', { name: /^Conditions/ }).getAttribute('aria-current')).toBe('page');
    // jsdom's history.back is asynchronous: wait for its popstate.
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/repositories/docs/board'));
    await waitFor(() => expect(screen.getByRole('link', { name: /^Board/ }).getAttribute('aria-current')).toBe('page'));
    expect(document.title).toBe('Board — Baton');
  });

  it('the repository picker moves to the same screen of another repository', async () => {
    shell();
    renderApp('/repositories/docs/conditions');
    const picker = await screen.findByRole('combobox', { name: 'Repository' });
    await waitFor(() => expect((picker as HTMLSelectElement).value).toBe('docs'));
    fireEvent.change(picker, { target: { value: 'ops' } });
    expect(window.location.pathname).toBe('/repositories/ops/conditions');
  });

  it('shows the tenant screens to an administrator’s session and hides them from an owner’s', async () => {
    shell('administrator');
    const admin = renderApp('/repositories/docs/board');
    expect(await screen.findByRole('link', { name: 'Instances' })).toBeDefined();
    admin.unmount();
    resetShell();
    shell('owner');
    renderApp('/instances');
    expect(await screen.findByRole('heading', { name: 'No such page' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Instances' })).toBeNull();
    expect(screen.getByText('/instances')).toBeDefined();
  });

  it('draws "No such page" for a path that names no screen', async () => {
    shell();
    renderApp('/nowhere/at/all');
    expect(await screen.findByRole('heading', { name: 'No such page' })).toBeDefined();
    act(() => navigate('/'));
    expect(await screen.findByRole('heading', { name: 'Repositories' })).toBeDefined();
  });
});

function TicketStub({ id }: { id: string }) {
  const read = useRead<{ id: string }>(`/v1/repositories/docs/tickets/${encodeURIComponent(id)}`);
  return <ReadGate read={read} entity="ticket" id={id}>{(t) => <p>ticket {t.id}</p>}</ReadGate>;
}

describe('the refusals (B-221 item 3)', () => {
  it('a repository the session cannot read: §11.4’s wording, linking /', async () => {
    shell();
    renderApp('/repositories/secret/board');
    expect(await screen.findByRole('heading', { name: REPOSITORY_REFUSED })).toBeDefined();
    expect(REPOSITORY_REFUSED).toBe('This repository is not yours or does not exist');
    expect(screen.getByRole('link', { name: 'Your repositories' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('navigation', { name: 'Repository overview' })).toBeNull();
  });

  it('forbidden on a read is the repository refusal; not-found is "No such ticket" with the id as text', async () => {
    mockFetch({
      '/v1/repositories/docs/tickets/R3-1': () => refuse('forbidden'),
      '/v1/repositories/docs/tickets/%3Cb%3Ex%3C%2Fb%3E': () => refuse('not-found'),
      '/v1/repositories/docs/tickets/R3-2': { id: 'R3-2' },
      '/v1/repositories/docs/tickets/R3-3': () => refuse('unavailable', 'try again', 503),
    });
    const forbidden = renderWithShell(<TicketStub id="R3-1" />);
    expect(await forbidden.findByRole('heading', { name: REPOSITORY_REFUSED })).toBeDefined();
    forbidden.unmount();
    const missing = renderWithShell(<TicketStub id="<b>x</b>" />);
    expect(await missing.findByRole('heading', { name: 'No such ticket' })).toBeDefined();
    expect(missing.container.querySelector('b')).toBeNull();
    expect(missing.getByText('<b>x</b>')).toBeDefined();
    missing.unmount();
    const found = renderWithShell(<TicketStub id="R3-2" />);
    expect(await found.findByText('ticket R3-2')).toBeDefined();
    found.unmount();
    // Any other code, with no answer held: the code and message, as text.
    const other = renderWithShell(<TicketStub id="R3-3" />);
    expect((await other.findByRole('alert')).textContent).toBe('unavailable — try again');
  });
});
