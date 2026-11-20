// root.test.tsx — B-208: the root screen and the overview strip, both from `GET
// /v1/repositories` alone. The cards order by `needs_you` descending, then id; an
// administrator's `seed_owners` notice; an owner's single repository goes to its board; the
// strip's three links, the SHADOW mark, the "conditions" label and the exclusive goal line; a
// hostile forge path is text; an empty list says which CLI line fills it.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { Strip } from '../../src/dashboard/app/Strip';
import { orderRepositories } from '../../src/dashboard/screens/root/RootScreen';
import { mockFetch, renderApp, renderWithShell, repoList, repoRow, resetShell } from './helpers';

const HOSTILE = '<img src=x onerror=alert(1)>';

afterEach(() => {
  cleanup();
  resetShell();
});

const serve = (list: ReturnType<typeof repoList>) => mockFetch({ '/v1/repositories': list, '/v1/actions': { actions: [] } });

describe('the root screen (B-208 item 1)', () => {
  it('orders by needs_you descending, then id', () => {
    const rows = [repoRow('b', { needs_you: 0 }), repoRow('c', { needs_you: 3 }), repoRow('a', { needs_you: 0 }), repoRow('d', { needs_you: 3 })];
    expect(orderRepositories(rows).map((r) => r.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('lists the caller’s repositories as cards from repo.list, the one that needs a person first', async () => {
    const { calls } = serve(repoList([
      repoRow('docs', { needs_you: 0, mode: 'cut-over' }),
      repoRow('ops', { needs_you: 4, mode: 'shadow', running: 1, ready: 9, runners_alive: 2, runners_total: 5, courses: [{ id: 'course-a', version: 3 }, { id: 'course-b', version: 1 }] }),
    ]));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Repositories' });
    const cards = [...document.querySelectorAll('.repo-card')] as HTMLElement[];
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual(['ops', 'docs']);
    const ops = within(cards[0]);
    expect(ops.getByRole('link', { name: 'ops' }).getAttribute('href')).toBe('/repositories/ops/board');
    expect(ops.getByText('SHADOW')).toBeDefined();
    expect(cards[0].querySelector('.repo-counts')?.textContent).toBe('running now 1 · ready 9 · conditions 4');
    expect(ops.getByRole('link', { name: /^conditions/ }).getAttribute('href')).toBe('/repositories/ops/conditions');
    expect(cards[0].textContent).toContain('cabec94c');
    expect(cards[0].textContent).toContain('2 alive of 5');
    expect(cards[0].textContent).toContain('course-a, course-b');
    // The forge link is built from web_base (R-BTN-92), its host shown.
    const forge = ops.getByRole('link', { name: /example-org\/ops/ });
    expect([forge.getAttribute('href'), forge.getAttribute('rel'), forge.textContent]).toEqual(['https://github.com/example-org/ops', 'noopener noreferrer', 'example-org/ops (github.com)']);
    expect(within(cards[1]).queryByText('SHADOW')).toBeNull();
    // No second read: the shell's two, and nothing of the root's own.
    expect([...new Set(calls.map((c) => c.path))].sort()).toEqual(['/v1/actions', '/v1/repositories']);
  });

  it('draws a hostile forge path as text, and a web_base that is no clean https URL as no link', async () => {
    serve(repoList([repoRow('docs', { github: HOSTILE, web_base: 'javascript:alert(1)' })]));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Repositories' });
    const card = document.querySelector('.repo-card') as HTMLElement;
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.repo-forge')?.textContent).toBe(HOSTILE);
    expect(card.querySelector('.repo-forge a')).toBeNull();
  });

  it('an administrator’s root names the repositories owned only by the seed, with the CLI line', async () => {
    serve(repoList([repoRow('docs'), repoRow('ops')], 'administrator', { seed_owners: ['ops'] }));
    renderApp('/');
    const note = (await screen.findByText(/Owned only by the seeded owner keys/)).closest('.band') as HTMLElement;
    expect(note.textContent).toContain('ops');
    expect(within(note).getByText(/baton admin repo set <repository> --add-owner-key/)).toBeDefined();
  });

  it('an owner’s session with one repository is sent to its board; with several it lists them', async () => {
    serve(repoList([repoRow('docs')], 'owner'));
    const one = renderApp('/');
    await waitFor(() => expect(window.location.pathname).toBe('/repositories/docs/board'));
    one.unmount();
    resetShell();
    serve(repoList([repoRow('docs'), repoRow('ops')], 'owner', { seed_owners: ['ops'] }));
    renderApp('/');
    expect(await screen.findByText('The repositories your key owns.')).toBeDefined();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText(/Owned only by the seeded owner keys/)).toBeNull();
  });

  it('an empty list says so for each role, with the CLI line', async () => {
    serve(repoList([], 'administrator'));
    const admin = renderApp('/');
    expect(await screen.findByText(/No repository is registered/)).toBeDefined();
    expect(screen.getByText(/^baton admin repo add/)).toBeDefined();
    admin.unmount();
    resetShell();
    serve(repoList([], 'owner'));
    renderApp('/');
    expect(await screen.findByText(/Your key owns no repository/)).toBeDefined();
    expect(screen.getByText(/^baton owner owners/)).toBeDefined();
  });
});

describe('the overview strip (B-208 item 2)', () => {
  it('draws the three counts as links, the head and the SHADOW mark, from the row alone', () => {
    const { container } = renderWithShell(<Strip row={repoRow('docs', { mode: 'shadow', running: 2, ready: 5, needs_you: 3 })} />);
    const strip = within(container.querySelector('nav.strip') as HTMLElement);
    expect(container.querySelector('.strip-counts')?.textContent).toBe('running now 2·ready 5·conditions 3');
    expect(strip.getByRole('link', { name: 'running now 2' }).getAttribute('href')).toBe('/repositories/docs/board');
    expect(strip.getByRole('link', { name: 'ready 5' }).getAttribute('href')).toBe('/repositories/docs/tickets');
    // Labelled "conditions" until B-57: the count is open conditions only (B-204).
    expect(strip.getByRole('link', { name: 'conditions 3' }).getAttribute('href')).toBe('/repositories/docs/conditions');
    expect(strip.queryByText(/needs you/)).toBeNull();
    expect(strip.getByText('SHADOW')).toBeDefined();
    expect(container.textContent).toContain('head cabec94c');
    expect(container.textContent).toMatch(/received 1 min ago/);
  });

  it('draws no SHADOW mark once cut over, and the exclusive goal where one is set', () => {
    const plain = renderWithShell(<Strip row={repoRow('docs')} />);
    expect(plain.queryByText('SHADOW')).toBeNull();
    expect(plain.queryByText(/exclusive goal/)).toBeNull();
    plain.unmount();
    const { container } = renderWithShell(<Strip row={repoRow('docs', { exclusive_goal: { id: 'g1', title: HOSTILE } })} />);
    const goal = within(container).getByRole('link', { name: `exclusive goal: ${HOSTILE}` });
    expect(goal.getAttribute('href')).toBe('/repositories/docs/goals');
    expect(container.querySelector('img')).toBeNull();
  });

  it('is on every repository screen and on no other', async () => {
    serve(repoList([repoRow('docs')]));
    const repo = renderApp('/repositories/docs/policy');
    expect(await screen.findByRole('navigation', { name: 'Repository overview' })).toBeDefined();
    repo.unmount();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Repositories' });
    expect(screen.queryByRole('navigation', { name: 'Repository overview' })).toBeNull();
  });

  it('draws a count the row does not carry as a dash, never a zero', () => {
    const { container } = renderWithShell(<Strip row={{ id: 'docs' }} />);
    expect(container.querySelector('.strip-counts')?.textContent).toBe('running now —·ready —·conditions —');
  });
});
