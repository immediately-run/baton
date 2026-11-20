// attestations.test.tsx — B-213: `/attestations` draws `attestation.list` as a table — type,
// subject (a ticket linking its page), value behind a disclosure, writer and class, state by
// word — with the filters in the URL and load-more by the read's cursor. Add attestation is
// the registry's to offer and the read's to allow: with the real registry no session is
// offered one, whatever `writable_types` says; with a fixture entry it is drawn only when the
// read names a writable type. A `human` row shows its class; lapsed and revoked rows are
// marked by word; a hostile subject and value are text; what is not built is said.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ACTIONS, actionsFor } from '../../src/core/actions';
import { SCREENS } from '../../src/core/screens';
import { AttestationsScreen, stateOf, type Attestation, type AttestationList } from '../../src/dashboard/screens/attestations/AttestationsScreen';
import type { Action } from '../../src/dashboard/lib/types';
import type { ScreenProps } from '../../src/dashboard/screens/contract';
import { goTo, mockFetch, renderWithShell, repoList, repoRow, resetShell, type Call } from './helpers';

const HOSTILE = '<img src=x onerror=alert(1)>';
const NOW = Date.now();
const SCREEN = SCREENS.find((s) => s.id === 'repository/attestations')!;
const repos = repoList([repoRow('docs')]);
const props: ScreenProps = { screen: SCREEN, params: { repository: 'docs' }, repository: repoRow('docs'), repos, role: 'administrator' };
const PATH = '/v1/repositories/docs/attestations';

const row = (id: number, over: Partial<Attestation> = {}): Attestation => ({
  id, type: 'std:decision@1', subject: { ticket: 'docs:A' }, value: { leg: 'leg-a', option: 'ship' }, writer: { credential: 'SHA256:abc', class: 'owner' },
  domain: null, at: NOW - 60_000, lapses_at: null, revoked_at: null, ...over,
});
const list = (attestations: Attestation[], over: Partial<AttestationList> = {}): AttestationList => ({
  attestations, writable_types: [], writable_why: 'an administrator’s session answers no person leg', types: ['std:decision@1'], not_built: { store: 'B-146', session_write: 'B-76' }, ...over,
});
const draw = (answer: AttestationList | ((c: Call) => AttestationList), actions: Action[] = actionsFor('administrator') as Action[]) => {
  const fetched = mockFetch({ [PATH]: typeof answer === 'function' ? (c: Call) => ({ body: answer(c) }) : answer });
  return { ...fetched, ...renderWithShell(<AttestationsScreen {...props} />, { actions, repos, now: NOW }) };
};

afterEach(() => {
  cleanup();
  resetShell();
});

describe('the Attestations screen (B-213)', () => {
  it('draws each row: type, subject linking its ticket, writer and class, state by word', async () => {
    draw(list([
      row(3, { writer: { credential: 'SHA256:human', class: 'human' } }),
      row(2, { subject: { commit: 'abc1234' }, lapses_at: NOW - 1000 }),
      row(1, { revoked_at: NOW - 500, writer: { credential: null, class: 'sync' } }),
    ]));
    const table = await screen.findByRole('table', { name: 'Attestations of the repository' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').at(-1)!.textContent)).toEqual(['in force', 'lapsed', 'revoked']);
    expect(within(rows[0]).getByRole('link', { name: 'docs:A' }).getAttribute('href')).toBe('/repositories/docs/tickets/A');
    expect(rows[0].textContent).toContain('human · SHA256:human');
    expect(rows[1].textContent).toContain('abc1234');
    expect(within(rows[1]).queryByRole('link')).toBeNull();
    expect(rows[2].textContent).toContain('sync');
    expect([rows[0].className, rows[1].className, rows[2].className]).toEqual(['', 'row-lapsed', 'row-lapsed']);
    expect(stateOf({ lapses_at: NOW + 1000, revoked_at: null }, NOW)).toBe('in force');
    // What is not built is said, with the ticket that builds it.
    expect(screen.getByText(/with lapses and revocation is not built yet/).textContent).toContain('B-146');
  });

  it('with the real registry no session is offered Add attestation; the CLI line is named instead', async () => {
    const { calls } = draw(list([row(1)], { writable_types: ['std:decision@1'], writable_why: null }));
    await screen.findByRole('heading', { name: 'Add attestation' });
    expect(ACTIONS.some((a) => a.ui?.view.includes('repository/attestations'))).toBe(false);
    const add = screen.getByRole('heading', { name: 'Add attestation' }).closest('section') as HTMLElement;
    expect(within(add).queryByRole('button')).toBeNull();
    expect(add.querySelector('.cli')!.textContent).toBe('baton decision answer -i KEY docs:<ticket> <option>');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('a registry entry is drawn only when the read names a writable type, its type a select of them', async () => {
    const entry: Action = {
      id: 'attestation.add', summary: 'Add attestation: write a typed statement.', effect: 'write', http: { method: 'POST', path: '/v1/ui/attestations' },
      callers: [{ principal: 'session', scope: 'instance', roles: ['owner'] }],
      input: { type: 'object', required: ['repository', 'type', 'subject'], properties: { repository: { type: 'string' }, type: { type: 'string', enum: ['std:decision@1'] }, subject: { type: 'string' } } },
      ui: { view: ['repository/attestations'] },
    };
    draw(list([row(1)]), [entry]);
    await screen.findByRole('heading', { name: 'Add attestation' });
    expect(screen.queryByRole('button', { name: /Add attestation/ })).toBeNull();
    expect(screen.getByText(/This page writes no attestation/).textContent).toContain('an administrator’s session answers no person leg');
    cleanup();
    draw(list([row(1)], { writable_types: ['std:decision@1'], writable_why: null }), [entry]);
    const button = await screen.findByRole('button', { name: /Add attestation/ });
    fireEvent.click(button);
    const select = await screen.findByLabelText(/^type/);
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['std:decision@1']);
  });

  it('a hostile subject, type, writer and value are text', async () => {
    draw(list([row(1, { type: HOSTILE, subject: HOSTILE, value: { note: HOSTILE }, writer: { credential: HOSTILE, class: HOSTILE }, domain: HOSTILE })]));
    await screen.findByRole('table', { name: 'Attestations of the repository' });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.value-cell pre')!.textContent).toContain(HOSTILE);
    expect(document.querySelector('tbody tr')!.textContent).toContain(HOSTILE);
  });

  it('the filters are the URL’s and the read’s; the cursor loads the next page', async () => {
    goTo('/repositories/docs/attestations?subject=A');
    const { calls } = draw((c) => (c.path.includes('cursor=c2') ? list([row(1)]) : list([row(2)], { next_cursor: 'c2' })));
    await screen.findByRole('table', { name: 'Attestations of the repository' });
    const reads = () => calls.filter((c) => c.path.startsWith(PATH)).map((c) => c.path);
    expect(reads()).toEqual([`${PATH}?subject=A`]);
    fireEvent.click(screen.getByLabelText('In force only'));
    await waitFor(() => expect(window.location.search).toBe('?subject=A&live=1'));
    await waitFor(() => expect(reads()).toContain(`${PATH}?subject=A&live=1`));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(reads()).toContain(`${PATH}?subject=A&live=1&cursor=c2`));
    fireEvent.change(screen.getByLabelText('Attestation type'), { target: { value: 'std:decision@1' } });
    await waitFor(() => expect(window.location.search).toBe('?subject=A&live=1&type=std%3Adecision%401'));
    // A new filter starts from the first page again.
    await waitFor(() => expect(reads().at(-1)).toBe(`${PATH}?subject=A&type=std%3Adecision%401&live=1`));
  });
});
