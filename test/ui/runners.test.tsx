// runners.test.tsx — B-211: the runner screens on B-196's reads. The cards group by hostname
// and order by state within a host; the claim block draws the lease bar; the newest status
// report is text under its card; Stop confirms `release` and draws a `forbidden` as
// text; an unlisted session link is text; the timeline's bars and nested segments match the
// fixture, each a focusable group with a name, and the table lists the same rows; a hostile
// label is text; `?since=` round-trips through the URL.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ACTIONS, actionsFor } from '../../src/core/actions';
import { SCREENS } from '../../src/core/screens';
import { RunnerScreen } from '../../src/dashboard/screens/runners/RunnerScreen';
import { groupByHost, RunnersScreen } from '../../src/dashboard/screens/runners/RunnersScreen';
import { stateOf } from '../../src/dashboard/screens/runners/RunnerCard';
import type { RunnerRow } from '../../src/dashboard/screens/runners/types';
import type { Action } from '../../src/dashboard/lib/types';
import { goTo, mockFetch, refuse, renderWithShell, repoList, repoRow, resetShell } from './helpers';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const H = 3_600_000;
const MIN = 60_000;
const HOSTILE = '<img src=x onerror=alert(1)>';
const actions = actionsFor('administrator') as Action[];
const repos = repoList([repoRow('docs')]);
const screenOf = (id: string) => SCREENS.find((s) => s.id === id)!;
const props = (id: string, params: Record<string, string>) => ({ screen: screenOf(id), params, repository: repos.repositories[0], repos, role: 'administrator' as const });

const runner = (id: number, over: Partial<RunnerRow> = {}): RunnerRow => ({
  runner_id: id, hostname: 'host-a', session_name: `s-${id}`, alive: true, last_seen_at: NOW - MIN, last_activity_at: NOW - 5 * MIN, reaped_at: null,
  harness: 'opencode', kind: 'vm', isolation: 'process',
  capabilities: [{ capability: 'cap-one', declared: 'cap-one' }, { capability: 'cap-two', declared: 'role-x' }], granted: ['cap-one'], tags: [],
  courses: [{ course: 'course-a', version: 3, min_runner_version: 3 }], lease_timeout_s: 900,
  credential: { kind: 'runner', granted: true, role: null, domain: null }, last_report: null, transcript_url: null,
  claim: null, claims: [], busy_elsewhere: false, reaped_claim: null, ...over,
});
const claim = (over: Record<string, unknown> = {}) => ({
  claim_id: 7, ticket_id: 'docs:T-1', station: 'st-one', leg: 'leg-one', run_id: 'r_01', claimed_at: NOW - 30 * MIN, lease_ends_at: NOW + 10 * MIN, deadline_at: null,
  attempt: 2, max_runs: 3, next_backoff_until: null, session_url: null, log_dir: '/var/log/baton/r_01', activity: { kind: 'implement', label: 'writing', started_at: NOW - 4 * MIN }, ...over,
});

const FLEET: RunnerRow[] = [
  runner(1, { session_name: 'idle-one', claim: null }),
  runner(2, { session_name: 'dead-one', alive: false, reaped_at: NOW - H, reaped_claim: { claim_id: 3, ticket_id: 'docs:T-9', ended_at: NOW - H, end_reason: 'reaped:silent' } }),
  runner(3, { session_name: 'working-one', claim: claim() as never, claims: [claim() as never], last_report: { payload: { text: HOSTILE }, sent_at: NOW - 2 * MIN } }),
  runner(4, { session_name: 'silent-one', last_activity_at: NOW - 3 * H, claim: claim({ claim_id: 8, ticket_id: 'docs:T-2', session_url: 'https://evil.example/s/1' }) as never }),
  runner(5, { hostname: 'host-b', session_name: 'elsewhere', busy_elsewhere: true, granted: null, credential: { kind: 'token', granted: false, role: null, domain: null } }),
];
const LIST = { runners: FLEET, not_built: { executor: 'B-184' }, server_time: NOW };

afterEach(() => {
  cleanup();
  resetShell();
});

describe('the Runners list (B-211 item 1)', () => {
  it('tells a runner’s state from the read, and groups by hostname in state order', () => {
    expect(FLEET.map((r) => stateOf(r, NOW))).toEqual(['idle', 'dead', 'working', 'silent', 'working']);
    const groups = groupByHost(FLEET, NOW);
    expect(groups.map((g) => g.hostname)).toEqual(['host-a', 'host-b']);
    expect(groups[0].rows.map((r) => r.session_name)).toEqual(['working-one', 'silent-one', 'idle-one', 'dead-one']);
  });

  it('draws a card per runner with its mark, chips, claim block, lease bar and report', async () => {
    mockFetch({ '/v1/repositories/docs/runners': LIST });
    renderWithShell(<RunnersScreen {...props('repository/runners', { repository: 'docs' })} />, { actions, repos, now: NOW });
    await screen.findByRole('heading', { name: 'Runners' });
    await screen.findByText('4 alive of 5');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['host-a', 'host-b']);
    const cards = [...document.querySelectorAll('.runner-card')] as HTMLElement[];
    expect(cards.map((c) => c.querySelector('.status')!.textContent)).toEqual(['●Working', '◆Silent', '○Idle', '✕Dead', '●Working']);

    const working = within(cards[0]);
    expect(working.getByRole('link', { name: 'host-a / working-one' }).getAttribute('href')).toBe('/repositories/docs/runners/3');
    expect(working.getByRole('link', { name: 'docs:T-1' }).getAttribute('href')).toBe('/repositories/docs/tickets/T-1');
    expect(cards[0].querySelector('.claim-line')!.textContent).toBe('docs:T-1 · leg leg-one · running for 30 min');
    // The lease bar: three quarters of the lease gone, ten minutes left.
    const lease = working.getByRole('img', { name: 'lease ends in 10 min' });
    expect((lease.querySelector('.lease-fill') as HTMLElement).style.width).toBe('75%');
    expect(cards[0].textContent).toContain('2 of 3');
    expect(cards[0].textContent).toContain('/var/log/baton/r_01');
    expect(cards[0].textContent).toContain('baton leg log docs:T-1 leg-one');
    // Granted capabilities are marked; a declared one that is not granted is not.
    expect([...cards[0].querySelectorAll('.chip')].map((c) => c.textContent)).toEqual(['cap-one ✓ granted', 'cap-two']);
    // The report is text under its card: the hostile string never becomes an element.
    expect(cards[0].querySelector('.runner-report')!.textContent).toContain(HOSTILE);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    // No model anywhere; the executor says what is not recorded and which ticket builds it.
    expect(cards[0].textContent).toContain('executor: not recorded (B-184)');

    // An unlisted session link is text, never a link.
    expect(within(cards[1]).queryByRole('link', { name: /Open leg page/ })).toBeNull();
    expect(cards[1].textContent).toContain('Open leg page');
    expect(cards[2].textContent).toContain('idle since');
    expect(cards[3].querySelector('.runner-reap')!.textContent).toMatch(/^lost its heartbeat; reaped at 2026-11-20 11:00 UTC; its claim on docs:T-9 was reaped$/);
    expect(cards[4].textContent).toContain('working on another repository');
    expect(cards[4].textContent).toContain('no grant binds it');

    // Controls come from the registry: Stop only where a claim is held, none on a reaped runner.
    const names = (c: HTMLElement) => within(c).queryAllByRole('button').map((b) => b.textContent);
    expect(names(cards[0])).toEqual(['Status', 'Wind down', 'Stop…']);
    expect(names(cards[2])).toEqual(['Status', 'Wind down']);
    expect(names(cards[3])).toEqual([]);
  });

  it('Stop confirms release and draws a forbidden as text', async () => {
    const { calls } = mockFetch({ '/v1/repositories/docs/runners': LIST, 'POST /v1/ui/messages': () => refuse('forbidden', `not this runner's ticket ${HOSTILE}`) });
    renderWithShell(<RunnersScreen {...props('repository/runners', { repository: 'docs' })} />, { actions, repos, now: NOW });
    await screen.findByText('4 alive of 5');
    const card = document.querySelector('.runner-card') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Stop…' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/v1/ui/messages', body: { to_runner_id: 3, kind: 'release', confirm: true, payload: { ticket_id: 'docs:T-1', reason: 'requested' } } });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(card.querySelector('.control-refusal')?.textContent).toContain('forbidden'));
    expect(card.querySelector('.control-refusal')!.textContent).toContain(HOSTILE);
    expect(document.querySelector('img[src="x"]')).toBeNull();

    // Status asks the runner, addressed by its id.
    fireEvent.click(within(card).getByRole('button', { name: 'Status' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').length).toBe(2));
    expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({ to_runner_id: 3, kind: 'status_request' });
  });

  it('S-BTN-311: closes an open Stop confirmation when a refresh replaces the claim', async () => {
    let fleet = LIST;
    const { calls } = mockFetch({ '/v1/repositories/docs/runners': () => ({ body: fleet }), 'POST /v1/ui/messages': {} });
    const { store } = renderWithShell(<RunnersScreen {...props('repository/runners', { repository: 'docs' })} />, { actions, repos, now: NOW });
    await screen.findByText('4 alive of 5');
    const controls = () => within(screen.getByRole('group', { name: 'Actions on runner 3' }));
    fireEvent.click(controls().getByRole('button', { name: 'Stop…' }));
    expect(within(screen.getByRole('dialog')).getByText('docs:T-1')).toBeDefined();

    const next = claim({ claim_id: 9, ticket_id: 'docs:T-3' }) as NonNullable<RunnerRow['claim']>;
    fleet = { ...LIST, runners: FLEET.map((r) => r.runner_id === 3 ? { ...r, claim: next, claims: [next] } : r) };
    await act(() => store.refresh());
    expect(screen.getByRole('link', { name: 'docs:T-3' })).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);

    fireEvent.click(controls().getByRole('button', { name: 'Stop…' }));
    expect(within(screen.getByRole('dialog')).getByText('docs:T-3')).toBeDefined();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.filter((c) => c.method === 'POST')).toMatchObject([
      { path: '/v1/ui/messages', body: { to_runner_id: 3, kind: 'release', confirm: true, payload: { ticket_id: 'docs:T-3' } } },
    ]);
  });

  it('says so when no runner is granted, and draws the repository refusal', async () => {
    mockFetch({ '/v1/repositories/docs/runners': { runners: [], server_time: NOW }, '/v1/repositories/ops/runners': () => refuse('forbidden') });
    const first = renderWithShell(<RunnersScreen {...props('repository/runners', { repository: 'docs' })} />, { actions, repos });
    expect(await screen.findByText(/No runner is granted on this repository/)).toBeDefined();
    first.unmount();
    renderWithShell(<RunnersScreen {...props('repository/runners', { repository: 'ops' })} />, { actions, repos });
    expect(await screen.findByText('This repository is not yours or does not exist')).toBeDefined();
  });
});

const WINDOW = {
  since: NOW - 24 * H, until: NOW,
  claims: [
    { claim_id: 5, ticket_id: 'docs:T-9', leg: 'leg-one', started_at: NOW - 12 * H, ended_at: NOW - 6 * H, end: 'released', end_reason: 'released:requested', detail: null,
      session_url: 'https://claude.ai/code/session_1', log_dir: null, runs: [],
      activities: [
        { id: 'round', parent_id: null, kind: 'review-round', label: HOSTILE, source: 'skill', started_at: NOW - 11 * H, ended_at: NOW - 8 * H, outcome: 'succeeded', detail: { note: HOSTILE } },
        { id: 'rev', parent_id: 'round', kind: 'reviewer', label: 'second look', source: 'skill', started_at: NOW - 10 * H, ended_at: NOW - 9 * H, outcome: 'failed', detail: null },
      ] },
    { claim_id: 7, ticket_id: 'docs:T-1', leg: 'leg-one', started_at: NOW - 30 * MIN, ended_at: null, end: 'running', end_reason: null, detail: null,
      session_url: 'https://evil.example/s/2', log_dir: '/var/log/baton/r_01', runs: [], activities: [] },
  ],
};
const SHOWN = {
  runner: { ...runner(3, { session_name: 'working-one', claim: claim() as never, claims: [claim() as never] }), profile: { cli: { version: '1.2.3' }, note: HOSTILE } },
  attempts: [{ run: 1, claim_id: 5, runner_id: 3, run_id: 'r_00', started_at: NOW - 12 * H, ended_at: NOW - 6 * H, end: 'released:requested', detail: HOSTILE }],
  window: WINDOW, not_built: { executor: 'B-184' }, server_time: NOW,
};

describe('one runner’s page (B-211 item 2)', () => {
  it('draws the card, the attempts, the profile and the timeline with the same rows as a table', async () => {
    mockFetch({ '/v1/repositories/docs/runners/3': SHOWN });
    goTo('/repositories/docs/runners/3');
    renderWithShell(<RunnerScreen {...props('repository/runners/{runner}', { repository: 'docs', runner: '3' })} />, { actions, repos, now: NOW });
    await screen.findByRole('heading', { level: 1, name: 'host-a / working-one' });
    expect(document.querySelectorAll('.runner-card').length).toBe(1);

    // The bars and the nested segments match the fixture.
    const bars = [...document.querySelectorAll('.tl-bar')];
    expect(bars.map((b) => b.getAttribute('class'))).toEqual(['tl-bar tl-end-released', 'tl-bar tl-end-running']);
    const first = bars[0].querySelector('rect')!;
    expect([Number(first.getAttribute('x')), Number(first.getAttribute('width'))]).toEqual([12 + 488, 244]);
    const segs = [...document.querySelectorAll('.tl-seg')];
    expect(segs.map((s) => s.getAttribute('class'))).toEqual(['tl-seg', 'tl-seg tl-seg-failed']);
    const [outer, inner] = segs.map((s) => s.querySelector('rect')!);
    expect(Number(inner.getAttribute('y'))).toBeGreaterThan(Number(outer.getAttribute('y')));
    // A failed outcome is marked by shape, not by colour alone.
    expect(segs[1].querySelector('path')).not.toBeNull();
    expect(segs[0].querySelector('path')).toBeNull();
    // Every bar and segment is a focusable group with an accessible name.
    for (const g of [...bars, ...segs]) {
      expect([g.tagName.toLowerCase(), g.getAttribute('role'), g.getAttribute('tabindex')]).toEqual(['g', 'button', '0']);
      expect(g.getAttribute('aria-label')!.length).toBeGreaterThan(10);
    }
    expect(bars[1].getAttribute('aria-label')).toBe('claim on docs:T-1, leg leg-one: running, from 2026-11-20 11:30 UTC, still running');
    // The bar's label is its end as a word: a text child.
    expect(bars[0].querySelector('text')!.textContent).toBe('○ T-9 released');
    expect(screen.getByRole('list', { name: 'Legend' }).textContent).toContain('claim, reaped');

    // The table under the drawing lists the same claims and activities.
    const table = screen.getByRole('table', { name: 'The window’s claims and activities' });
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows.length).toBe(bars.length + segs.length);
    expect(rows[0]).toContain('claimdocs:T-9 · leg-one');
    expect(rows[1]).toContain(`activity review-round${HOSTILE}`);
    expect(rows[2]).toContain('✕ failed');
    expect(rows[3]).toContain('running');
    // The hostile label, detail, profile and attempt detail are text.
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.body.textContent).toContain(`"note": "${HOSTILE}"`.replace(/"/g, '"'));

    // Choosing a segment with the keyboard opens its panel.
    fireEvent.keyDown(segs[0], { key: 'Enter' });
    const panel = screen.getByRole('region', { name: 'The chosen segment' });
    expect(panel.textContent).toContain(HOSTILE);
    expect(segs[0].getAttribute('aria-pressed')).toBe('true');
    // The claim's session link passed `session_hosts`: a link, its host shown.
    const link = within(panel).getByRole('link', { name: /Open leg page/ });
    expect([link.getAttribute('href'), link.textContent]).toEqual(['https://claude.ai/code/session_1', 'Open leg page (claude.ai)']);
    expect(panel.textContent).toContain('digest, environment and instance are not recorded (B-184)');
    // The other claim's link is on no list: text.
    fireEvent.click(bars[1]);
    const second = screen.getByRole('region', { name: 'The chosen segment' });
    expect(within(second).queryByRole('link', { name: /Open leg page/ })).toBeNull();
    expect(second.textContent).toContain('Open leg page');
    expect(second.textContent).toContain('/var/log/baton/r_01');
    expect(second.textContent).toContain('baton leg log docs:T-1 leg-one');

    const attempts = screen.getByRole('table', { name: 'Earlier attempts on the live ticket’s leg' });
    expect(within(attempts).getAllByRole('row')[1].textContent).toContain(`released:requested${HOSTILE}`);
  });

  it('?since= round-trips: the URL’s window is the read’s, and a choice writes it back', async () => {
    const { calls } = mockFetch({
      '/v1/repositories/docs/runners/3?since=7d': { ...SHOWN, window: { ...WINDOW, since: NOW - 7 * 24 * H } },
      '/v1/repositories/docs/runners/3?since=3d': { ...SHOWN, window: { ...WINDOW, since: NOW - 3 * 24 * H } },
    });
    goTo('/repositories/docs/runners/3?since=7d');
    renderWithShell(<RunnerScreen {...props('repository/runners/{runner}', { repository: 'docs', runner: '3' })} />, { actions, repos, now: NOW });
    await screen.findByText(/the last 7 d/);
    expect(calls.map((c) => c.path)).toContain('/v1/repositories/docs/runners/3?since=7d');
    const picker = screen.getByRole('navigation', { name: 'Window' });
    expect(within(picker).getByText('7 d').getAttribute('aria-current')).toBe('true');
    fireEvent.click(within(picker).getByText('3 d'));
    await screen.findByText(/the last 3 d/);
    expect(window.location.search).toBe('?since=3d');
    expect(calls.map((c) => c.path)).toContain('/v1/repositories/docs/runners/3?since=3d');
  });

  it('a since that is no span is not sent; an unknown runner is “No such runner”', async () => {
    const { calls } = mockFetch({ '/v1/repositories/docs/runners/3': SHOWN, '/v1/repositories/docs/runners/99': () => refuse('not-found') });
    goTo('/repositories/docs/runners/3?since=%3Cb%3E');
    const first = renderWithShell(<RunnerScreen {...props('repository/runners/{runner}', { repository: 'docs', runner: '3' })} />, { actions, repos, now: NOW });
    await screen.findByText(/the last 24 h/);
    expect(calls.map((c) => c.path)).toEqual(['/v1/repositories/docs/runners/3']);
    first.unmount();
    renderWithShell(<RunnerScreen {...props('repository/runners/{runner}', { repository: 'docs', runner: '99' })} />, { actions, repos });
    expect(await screen.findByRole('heading', { name: 'No such runner' })).toBeDefined();
    expect(screen.getByText('99')).toBeDefined();
  });

  it('the registry places the three runner controls on the runner’s screen', () => {
    const placed = ACTIONS.filter((a) => a.ui?.view.includes('repository/runners/{runner}')).map((a) => a.id).sort();
    expect(placed).toEqual(['leg.stop', 'runner.status-request', 'runner.wind-down']);
  });
});
