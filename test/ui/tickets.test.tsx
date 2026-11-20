// tickets.test.tsx — B-209: the Tickets table and the Board, each from fixture reads. The table
// draws each state's shape and word and its reason band; the tabs carry the read's counts and
// set `?state=`; `?q=` and `?tier=` round-trip through the URL; no sort control exists; a
// hostile title and hold reason stay text; load-more follows the cursor. The Board's Ready
// order is the read's, the failed rule is drawn for a ticket nobody can take, Running draws the
// lease bar, `stalled` and the condition a leg waits on.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { STATE_MARKS } from '../../src/dashboard/screens/tickets/parts';
import { tabCount, TICKET_TABS } from '../../src/dashboard/screens/tickets/TicketsScreen';
import type { TicketRow } from '../../src/dashboard/screens/tickets/types';
import { mockFetch, renderApp, repoList, repoRow, resetShell, type Route } from './helpers';

const HOSTILE = '<img src=x onerror=alert(1)>';
const NOW = Date.now();
const HOUR = 3_600_000;

afterEach(() => {
  cleanup();
  resetShell();
});

const row = (local: string, state: string, over: Partial<TicketRow> = {}): TicketRow => ({
  ticket_id: `docs:${local}`, title: `${local} title`, course: 'course-a', tier: 'routine', requires: [], requires_unmet: [], tags: [], order: null, parent: null, expedite: false,
  position: { station: 'station-a', path_len: 0, next_leg: 'leg-a' }, state, reasons: [], detail: {}, ...over,
});

const ROWS: TicketRow[] = [
  row('READY', 'ready', { eligible_runners: [{ runner_id: 4, hostname: 'host-four', session_name: 'sess-four' }], failed_rule: null, requires: ['cap-a'] }),
  row('STUCK', 'ready', { eligible_runners: [], failed_rule: 'above-tier-ceiling', tier: 'critical' }),
  row('UNCONF', 'unconfirmed', { detail: { claim_id: 9, reported_at: NOW - HOUR, runner_id: 2, hostname: 'host-two' } }),
  row('RUN', 'running', { detail: { claim_id: 7, runner_id: 1, hostname: 'host-one', session_name: 'sess-one', leg: 'leg-b', since: NOW - HOUR, lease_ends_at: NOW + HOUR, last_activity_at: NOW - 3 * HOUR, alive: true, stalled: true, condition_wait: 31 } }),
  row('PERSON', 'waiting-person', { detail: { leg: 'leg-p', question_id: 'q-7' } }),
  row('HELD', 'held', { reasons: ['blocked'], title: HOSTILE, detail: { set_by: 'owner:abc', reason: HOSTILE, since: NOW - 2 * HOUR } }),
  row('BLOCKED', 'blocked', { requires: ['cap-x'], requires_unmet: ['cap-x'], detail: { kind: 'capability', ref: 'cap-x', since: NOW - HOUR } }),
  row('DEP', 'blocked', { detail: { kind: 'ticket', ref: 'docs:READY', since: NOW - HOUR } }),
  row('BACKOFF', 'backing-off', { detail: { attempt: 2, max_runs: 3, until: NOW + HOUR } }),
  row('REST', 'suspended', { detail: { station: 'station-b', waits_for: 'label-w' } }),
  row('DONE', 'closed', { title: null, position: null, detail: { at: NOW - HOUR, end: 'done' } }),
];
const COUNTS = { unconfirmed: 1, running: 2, 'waiting-person': 1, held: 1, blocked: 6, 'backing-off': 1, suspended: 1, ready: 5, closed: 1, total: 19 };
const LIST = '/v1/repositories/docs/tickets';

function serve(routes: Record<string, Route> = {}) {
  return mockFetch({
    '/v1/repositories': repoList([repoRow('docs', { tiers: ['routine', 'judgement', 'critical'] })]),
    '/v1/actions': { actions: [] },
    [LIST]: { tickets: ROWS, counts: COUNTS, matched: ROWS.length },
    ...routes,
  });
}
const rowOf = (local: string) => [...document.querySelectorAll('tr.tk-row')].find((tr) => tr.querySelector('th .mono')?.textContent === `docs:${local}`) as HTMLElement;
const bandOf = (local: string) => rowOf(local).nextElementSibling as HTMLElement;

describe('the Tickets table (B-209 item 2)', () => {
  it('sums a tab’s count from the read’s counts, and draws none where the read has none', () => {
    const blocked = TICKET_TABS.find((t) => t.id === 'blocked')!;
    expect(tabCount(COUNTS, blocked.states)).toBe(10);
    expect(tabCount(COUNTS, null)).toBe(19);
    expect(tabCount(undefined, blocked.states)).toBeNull();
    expect(tabCount({ held: 1 }, blocked.states)).toBeNull();
  });

  it('draws each state’s shape and word, the reason band under the row, the position and the chips', async () => {
    serve();
    renderApp('/repositories/docs/tickets');
    const table = await screen.findByRole('table', { name: 'Tickets' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Ticket', 'State', 'Position', 'Tier', 'Requires']);
    // The order is the read's: no row is moved.
    expect([...table.querySelectorAll('tr.tk-row th')].map((th) => th.textContent!.split(' ')[0])).toEqual(ROWS.map((r) => r.ticket_id));
    for (const r of ROWS) {
      const cell = rowOf(r.ticket_id.slice(5)).querySelector('.tk-state') as HTMLElement;
      expect([r.state, cell.querySelector('.status-glyph')?.textContent, cell.querySelector('.status-label')?.textContent]).toEqual([r.state, STATE_MARKS[r.state].glyph, r.state]);
    }
    expect(rowOf('READY').querySelector('a')!.getAttribute('href')).toBe('/repositories/docs/tickets/READY');
    expect(rowOf('READY').classList.contains('tk-has-band')).toBe(false);
    expect(bandOf('STUCK').textContent).toBe('Nobody can take it — above-tier-ceiling');
    expect(bandOf('UNCONF').textContent).toMatch(/^host-two reported it done 1 h ago; no snapshot has confirmed it yet$/);
    expect(bandOf('RUN').textContent).toMatch(/^Stalled — no activity since 3 h ago · Waits on condition 31$/);
    expect(within(bandOf('RUN')).getByRole('link', { name: 'condition 31' }).getAttribute('href')).toBe('/repositories/docs/conditions/31');
    expect(rowOf('RUN').textContent).toContain('host-one');
    expect(within(rowOf('RUN')).getByRole('link', { name: /host-one/ }).getAttribute('href')).toBe('/repositories/docs/runners/1');
    expect(bandOf('PERSON').textContent).toBe('Decision open — a person answers leg-p (question q-7)');
    expect(rowOf('HELD').querySelector('.tk-also')!.textContent).toBe(' also blocked');
    expect(bandOf('BLOCKED').textContent).toBe('No capable runner — needs cap-x');
    expect(rowOf('BLOCKED').querySelector('.chip-unmet')!.textContent).toBe('▲ cap-x · no live runner');
    expect(rowOf('READY').querySelector('.chip')!.textContent).toBe('cap-a');
    expect(rowOf('READY').querySelector('.chip-unmet')).toBeNull();
    expect(bandOf('DEP').textContent).toBe('Waiting on docs:READY');
    expect(within(bandOf('DEP')).getByRole('link').getAttribute('href')).toBe('/repositories/docs/tickets/READY');
    expect(bandOf('BACKOFF').textContent).toBe('Backing off — 2 of 3 failed attempts; offered again in 1 h');
    expect(bandOf('REST').textContent).toBe('Resting at station-b — waits for label-w');
    expect(bandOf('DONE').textContent).toBe('Closed as done 1 h ago');
    expect(rowOf('READY').querySelector('[data-label="Position"]')!.textContent).toBe('station-a → leg-a');
    expect(screen.getByText(`Showing ${ROWS.length} of ${ROWS.length}`)).toBeDefined();
    // No sort control: the headers are plain cells and no button or select orders the list.
    expect(table.querySelectorAll('thead button, thead a, thead select').length).toBe(0);
    expect(screen.queryByRole('button', { name: /sort/i })).toBeNull();
  });

  it('draws a hostile title and hold reason as text', async () => {
    serve();
    renderApp('/repositories/docs/tickets');
    await screen.findByRole('table', { name: 'Tickets' });
    expect(document.querySelector('img')).toBeNull();
    expect(rowOf('HELD').querySelector('.tk-title')!.textContent).toBe(` ${HOSTILE}`);
    expect(bandOf('HELD').textContent).toBe(`Held by owner:abc: ${HOSTILE} · 2 h ago`);
  });

  it('the tabs carry the read’s counts and set ?state=; ?q= and ?tier= round-trip through the URL', async () => {
    const blocked = ROWS.filter((r) => ['held', 'blocked', 'waiting-person', 'backing-off', 'suspended'].includes(r.state));
    const { calls } = serve({
      [`${LIST}?state=blocked`]: { tickets: blocked, counts: COUNTS, matched: blocked.length },
      [`${LIST}?state=blocked&q=dep`]: { tickets: [ROWS[7]], counts: COUNTS, matched: 1 },
      [`${LIST}?state=blocked&q=dep&tier=judgement`]: { tickets: [], counts: COUNTS, matched: 0 },
    });
    renderApp('/repositories/docs/tickets');
    const tabs = within(await screen.findByRole('tablist', { name: 'Ticket states' }));
    await screen.findByRole('table', { name: 'Tickets' });
    expect(tabs.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All19', 'Ready5', 'Running2', 'Blocked10', 'Unconfirmed1', 'Closed today1']);
    expect(tabs.getByRole('tab', { name: /^All/ }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(tabs.getByRole('tab', { name: /^Blocked/ }));
    expect(window.location.search).toBe('?state=blocked');
    await waitFor(() => expect(screen.getByText(`Showing ${blocked.length} of ${blocked.length}`)).toBeDefined());
    expect(tabs.getByRole('tab', { name: /^Blocked/ }).getAttribute('aria-selected')).toBe('true');
    // The counts stay the whole repository's under a filter.
    expect(tabs.getByRole('tab', { name: /^All/ }).textContent).toBe('All19');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by id or title' }), { target: { value: 'dep' } });
    expect(window.location.search).toBe('?state=blocked&q=dep');
    await waitFor(() => expect(screen.getByText('Showing 1 of 1')).toBeDefined());
    fireEvent.change(document.querySelector('.tk-tier select') as HTMLSelectElement, { target: { value: 'judgement' } });
    expect(window.location.search).toBe('?state=blocked&q=dep&tier=judgement');
    expect(await screen.findByText('No ticket matches this view.')).toBeDefined();
    expect(calls.map((c) => c.path)).toContain(`${LIST}?state=blocked&q=dep&tier=judgement`);
    expect((screen.getByRole('searchbox', { name: 'Filter by id or title' }) as HTMLInputElement).value).toBe('dep');
  });

  it('opens on the view its URL names, and follows the cursor on load-more', async () => {
    const { calls } = serve({
      [`${LIST}?state=ready&q=x&tier=critical`]: { tickets: [ROWS[0]], counts: COUNTS, matched: 2, next_cursor: 'c.1' },
      [`${LIST}?state=ready&q=x&tier=critical&cursor=c.1`]: { tickets: [ROWS[1]], counts: COUNTS, matched: 2 },
    });
    renderApp('/repositories/docs/tickets?state=ready&q=x&tier=critical');
    expect(await screen.findByText('Showing 1 of 2')).toBeDefined();
    expect((screen.getByRole('searchbox', { name: 'Filter by id or title' }) as HTMLInputElement).value).toBe('x');
    expect((document.querySelector('.tk-tier select') as HTMLSelectElement).value).toBe('critical');
    expect(screen.getByRole('tab', { name: /^Ready/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Showing 2 of 2')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(calls.some((c) => c.path === `${LIST}?state=ready&q=x&tier=critical&cursor=c.1`)).toBe(true);
    // No second read beyond the list (and the shell's two).
    expect([...new Set(calls.map((c) => c.path.split('?')[0]))].sort()).toEqual(['/v1/actions', '/v1/repositories', LIST]);
  });

  it('says so when the repository has no ticket, and draws the one refusal for a repository not the caller’s', async () => {
    serve({ [LIST]: { tickets: [], counts: { total: 0 }, matched: 0 } });
    const empty = renderApp('/repositories/docs/tickets');
    expect(await screen.findByText('This repository has no ticket on its board.')).toBeDefined();
    empty.unmount();
    resetShell();
    serve({ [LIST]: () => ({ status: 403, body: { ok: false, code: 'forbidden', message: 'no' } }) });
    renderApp('/repositories/docs/tickets');
    expect(await screen.findByText(/This repository is not yours or does not exist/)).toBeDefined();
  });
});

describe('the Board (B-209 item 1)', () => {
  const ready = [ROWS[0], ROWS[1]];
  const running = [ROWS[3], row('QUIET', 'running', { detail: { claim_id: 8, runner_id: 2, hostname: 'host-two', session_name: 'host-two', leg: 'leg-c', since: NOW - 600_000, lease_ends_at: NOW + 300_000, alive: true, stalled: false, condition_wait: null } })];
  const board = (over: object = {}) => ({ ready_by_tier: { routine: ['docs:READY'], judgement: ['docs:READY'], critical: ['docs:READY', 'docs:STUCK'] }, granted_capabilities: null, ...over });
  const serveBoard = (routes: Record<string, Route> = {}) => serve({
    '/v1/repositories/docs/board': board(),
    [`${LIST}?state=ready`]: { tickets: ready, counts: COUNTS, matched: 2 },
    [`${LIST}?state=running`]: { tickets: running, counts: COUNTS, matched: 2 },
    ...routes,
  });

  it('Ready keeps the read’s order, names the eligible runners, and draws the failed rule', async () => {
    serveBoard();
    renderApp('/repositories/docs/board');
    const table = await screen.findByRole('table', { name: 'Ready tickets' });
    expect([...table.querySelectorAll('tbody th')].map((th) => th.textContent!.split(' ')[0])).toEqual(['docs:READY', 'docs:STUCK']);
    const first = table.querySelectorAll('tbody tr')[0] as HTMLElement;
    expect(within(first).getByRole('link', { name: /host-four/ }).getAttribute('href')).toBe('/repositories/docs/runners/4');
    expect(first.querySelector('[data-label="Requires"]')!.textContent).toBe('cap-a');
    const stuck = table.querySelectorAll('tbody tr')[1] as HTMLElement;
    expect(stuck.querySelector('[data-label="Who can take it"]')!.textContent).toBe('▲nobody can take it — above-tier-ceiling');
    expect(document.querySelector('.bd-tiers')!.textContent).toBe('Ready under each tier ceiling: routine 1 · judgement 1 · critical 2');
    // No control on the Board.
    expect(document.querySelector('.controls')).toBeNull();
    expect(screen.getByText(/names a grant’s capabilities to the granted runner’s own key/)).toBeDefined();
  });

  it('Running draws the holder, the leg, the lease bar with now marked, stalled and the condition it waits on', async () => {
    serveBoard();
    renderApp('/repositories/docs/board');
    const table = await screen.findByRole('table', { name: 'Running tickets' });
    const [stalled, quiet] = [...table.querySelectorAll('tbody tr')] as HTMLElement[];
    expect(within(stalled).getByRole('link', { name: /host-one/ }).getAttribute('href')).toBe('/repositories/docs/runners/1');
    expect(stalled.querySelector('[data-label="Leg"]')!.textContent).toBe('leg-b');
    expect(stalled.querySelector('[data-label="Running for"]')!.textContent).toMatch(/^(1 h|60 min)$/);
    const lease = stalled.querySelector('.lease') as HTMLElement;
    expect(lease.getAttribute('aria-label')).toMatch(/^lease: (1 h|60 min) left$/);
    expect(lease.querySelector('.lease-now')).not.toBeNull();
    expect(Number.parseFloat((lease.querySelector('.lease-fill') as HTMLElement).style.width)).toBeGreaterThan(40);
    expect(within(stalled).getByText('stalled')).toBeDefined();
    expect(within(stalled).getByRole('link', { name: 'waits on condition 31' }).getAttribute('href')).toBe('/repositories/docs/conditions/31');
    expect(within(quiet).queryByText('stalled')).toBeNull();
    expect(quiet.querySelector('[data-label="Notes"]')!.textContent).toBe('—');
  });

  it('follows each list to its end by cursor, draws granted capabilities as chips, and says when nothing runs', async () => {
    const { calls } = serveBoard({
      '/v1/repositories/docs/board': board({ granted_capabilities: ['cap-a', HOSTILE] }),
      [`${LIST}?state=ready`]: { tickets: [ready[0]], counts: COUNTS, matched: 2, next_cursor: 'r.1' },
      [`${LIST}?state=ready&cursor=r.1`]: { tickets: [ready[1]], counts: COUNTS, matched: 2 },
      [`${LIST}?state=running`]: { tickets: [], counts: COUNTS, matched: 0 },
    });
    renderApp('/repositories/docs/board');
    await waitFor(() => expect(screen.getByRole('table', { name: 'Ready tickets' }).querySelectorAll('tbody tr').length).toBe(2));
    expect(calls.some((c) => c.path === `${LIST}?state=ready&cursor=r.1`)).toBe(true);
    expect(screen.getByText('No ticket is claimed.')).toBeDefined();
    const chips = [...document.querySelectorAll('.section:last-of-type .chip')].map((c) => c.textContent);
    expect(chips).toEqual(['cap-a', HOSTILE]);
    expect(document.querySelector('img')).toBeNull();
  });
});
