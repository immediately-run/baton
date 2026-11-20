// sync.test.tsx — B-220: the Sync screen on `repo.sync`, with the real registry's entries.
// Resync and Accept send with one click and no dialog; Cut over and Confirm adoption are
// destructive — the confirm dialog, which sends `confirm: true` — and each is drawn only where
// the read's `allowed` names it, so a read that allows none draws none; no control forces a
// resync, and the page says it is not built. The head's sha links the forge commit through
// `web_base`; an outstanding observation is marked past ten minutes; the Discrepancies table
// links each ticket's history, strikes what Baton had, and draws a hostile `git` value as
// text; `?since=` round-trips through the URL and the read.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ACTIONS, actionsFor } from '../../src/core/actions';
import { SCREENS } from '../../src/core/screens';
import { commitHref, sinceOf, SyncScreen, type SyncView } from '../../src/dashboard/screens/sync/SyncScreen';
import type { Action } from '../../src/dashboard/lib/types';
import type { ScreenProps } from '../../src/dashboard/screens/contract';
import { goTo, mockFetch, refuse, renderWithShell, repoList, repoRow, resetShell, type Route } from './helpers';

const HOSTILE = '<img src=x onerror=alert(1)>';
const NOW = Date.parse('2026-11-20T12:30:00Z');
const SCREEN = SCREENS.find((s) => s.id === 'repository/sync')!;
const SHA = 'cabec94c0123456789abcdef0123456789abcdef';
const HELD = 'feedbeef0123456789abcdef0123456789abcdef';
const row = repoRow('docs');
const repos = repoList([row]);
const props: ScreenProps = { screen: SCREEN, params: { repository: 'docs' }, repository: row, repos, role: 'administrator' };
const PATH = '/v1/repositories/docs/sync';
const actions = actionsFor('administrator') as Action[];

const view = (over: Partial<SyncView> = {}): SyncView => ({
  repository: 'docs',
  head: { sha: SHA, parent_sha: null, received_at: NOW - 120_000, ticket_count: 241, observation: 7, source: { kind: 'markdown', versions: null } },
  observation: { last: 7, last_handed_out: 7, outstanding: null },
  last_post: { at: NOW - 120_000, sha: SHA, accepted: true },
  dispatch: { sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: null, last_sync_dispatch_at: NOW - 300_000, window: null, last_resync_request_at: null, last_refusal: null },
  held: [], mode: { mode: 'cut-over', cutover_at: NOW - 86_400_000 },
  adoptions: [], discrepancies: { since: NOW - 7 * 86_400_000, by_kind: {}, rows: [], truncated: false },
  allowed: ['repo.resync'], not_built: { wants: 'R-BTN-94', force_resync: 'R-BTN-11' }, ...over,
});
const draw = (answer: SyncView, extra: Record<string, Route> = {}, acts: Action[] = actions) => {
  const fetched = mockFetch({ [PATH]: answer, ...extra });
  return { ...fetched, ...renderWithShell(<SyncScreen {...props} />, { actions: acts, repos, now: NOW }) };
};
const posts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body]);

afterEach(() => {
  cleanup();
  resetShell();
});

describe('the Sync screen (B-220)', () => {
  it('draws the mode, the head linking its forge commit, the observation counter and the last post', async () => {
    draw(view());
    const head = (await screen.findByRole('heading', { name: 'Head' })).closest('section') as HTMLElement;
    const commit = within(head).getByRole('link', { name: /cabec94c/ });
    expect([commit.getAttribute('href'), commit.textContent]).toEqual([`https://github.com/example-org/docs/commit/${SHA}`, 'cabec94c (github.com)']);
    expect(head.textContent).toContain('241 tickets · source markdown');
    expect(screen.queryByText('SHADOW')).toBeNull();
    expect(document.querySelector('.band')!.textContent).toContain('Baton allocates docs’s work');
    expect(screen.getByText(/every number handed out was posted/)).toBeDefined();
    expect(screen.getByText('accepted')).toBeDefined();
    expect(screen.getByText(/The list of outstanding wants is not built yet/).textContent).toContain('R-BTN-94');
    // The forge link is web_base's alone: a git repository has no commit page, a hostile base none.
    expect(commitHref({ forge: 'git', web_base: 'https://git.example/x' }, SHA)).toBeNull();
    expect(commitHref({ forge: 'gitlab', web_base: 'https://gitlab.example/g/p/' }, SHA)).toBe(`https://gitlab.example/g/p/-/commit/${SHA}`);
    expect(commitHref({ forge: 'github', web_base: 'https://github.com/example-org/docs' }, '../../x')).toBeNull();
  });

  it('Resync is one click with no dialog, and refetches', async () => {
    const { calls } = draw(view(), { 'POST /v1/ui/resync': { ok: true } });
    fireEvent.click(await screen.findByRole('button', { name: 'Resync' }));
    await waitFor(() => expect(posts(calls)).toEqual([['/v1/ui/resync', { repository: 'docs' }]]));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === PATH).length).toBeGreaterThan(1));
  });

  it('a refused resync is drawn as its code and message, as text', async () => {
    draw(view(), { 'POST /v1/ui/resync': () => refuse('conflict', `a resync was asked ${HOSTILE}`) });
    fireEvent.click(await screen.findByRole('button', { name: 'Resync' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(`conflict — a resync was asked ${HOSTILE}`);
    expect(document.querySelector('img')).toBeNull();
  });

  it('a held post is accepted with one click; one already accepted has no control', async () => {
    const held = [
      { sha: HELD, parent_sha: SHA, head_sha: SHA, ticket_count: 240, received_at: NOW - 3_600_000, auto_accept_at: NOW + 82_800_000, accepted_at: null },
      { sha: 'a'.repeat(40), parent_sha: SHA, head_sha: SHA, ticket_count: 239, received_at: NOW - 7_200_000, auto_accept_at: NOW + 79_200_000, accepted_at: NOW - 60_000 },
    ];
    const { calls } = draw(view({ held, allowed: ['repo.resync', 'repo.accept-post'], last_post: { at: NOW - 3_600_000, sha: HELD, accepted: false, code: 'snapshot-rejected' } }), { 'POST /v1/ui/board/accept': { ok: true } });
    const section = (await screen.findByRole('heading', { name: 'Held posts' })).closest('section') as HTMLElement;
    const rows = [...section.querySelectorAll('.needs-row')] as HTMLElement[];
    expect(rows.map((r) => r.querySelector('.needs-kind')!.textContent)).toEqual(['‖Held', '‖Accepted']);
    expect(within(rows[1]).queryByRole('button')).toBeNull();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Accept a held board post' }));
    await waitFor(() => expect(posts(calls)).toEqual([['/v1/ui/board/accept', { repository: 'docs', sha: HELD }]]));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('refused and held')).toBeDefined();
  });

  it('Cut over and Confirm adoption open the confirm dialog and send confirm: true; nothing forces a resync', async () => {
    const adoptions = [{ ticket_id: 'docs:R3-9001', claim_id: 12, runner_id: 5, requested_at: NOW - 30_000, hostname: 'vm-a', session_name: 's-vm-a', legacy_session: 'item-R3-9001' }];
    const { calls } = draw(view({ mode: { mode: 'shadow', cutover_at: null }, adoptions, allowed: ['repo.resync', 'repo.cutover', 'adoption.confirm'] }), {
      'POST /v1/ui/cutover': { ok: true }, 'POST /v1/ui/adoptions/docs%3AR3-9001/confirm': { ok: true },
    });
    expect(await screen.findByText('SHADOW')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cut a repository over…' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('docs');
    expect(posts(calls)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cut a repository over' }));
    await waitFor(() => expect(posts(calls)).toEqual([['/v1/ui/cutover', { repository: 'docs', confirm: true }]]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The adoption names the requesting runner as the read shows it, in the row and the dialog.
    const section = screen.getByRole('heading', { name: 'Adoptions' }).closest('section') as HTMLElement;
    expect(section.textContent).toContain('by s-vm-a on vm-a (runner 5)');
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm an adoption…' }));
    const second = await screen.findByRole('dialog');
    expect(second.textContent).toContain('s-vm-a');
    fireEvent.click(within(second).getByRole('button', { name: 'Confirm an adoption' }));
    await waitFor(() => expect(posts(calls).at(-1)).toEqual(['/v1/ui/adoptions/docs%3AR3-9001/confirm', { confirm: true }]));
    // No entry forces a resync, and the page says why.
    expect(ACTIONS.filter((a) => a.ui?.view.includes('repository/sync')).map((a) => a.id).sort()).toEqual(['adoption.confirm', 'repo.accept-post', 'repo.cutover', 'repo.resync']);
    expect(screen.queryByRole('button', { name: /[Ff]orc/ })).toBeNull();
    expect(screen.getByText(/Forcing the head onto a rewritten history is not built/).textContent).toContain('R-BTN-11');
  });

  it('a read that allows none draws no control, whatever the registry lists; an owner’s read has no adoptions section', async () => {
    const { adoptions: _none, ...owner } = view({ mode: { mode: 'shadow', cutover_at: null }, allowed: [], held: [{ sha: HELD, parent_sha: SHA, head_sha: SHA, ticket_count: 1, received_at: NOW, auto_accept_at: NOW + 1, accepted_at: null }] });
    draw(owner as SyncView);
    await screen.findByRole('heading', { name: 'Head' });
    expect(screen.queryByRole('button', { name: /Resync|Accept|Cut|Confirm/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Adoptions' })).toBeNull();
  });

  it('marks an outstanding observation past ten minutes', async () => {
    draw(view({ observation: { last: 7, last_handed_out: 8, outstanding: { number: 8, handed_out_at: NOW - 120_000, age_s: 120, void: false } } }));
    const fresh = (await screen.findByText(/handed out 2 min ago/)).closest('.status') as HTMLElement;
    expect([fresh.className, fresh.textContent]).toEqual(['status tone-run', '◆number 8, handed out 2 min ago']);
    cleanup();
    draw(view({ observation: { last: 7, last_handed_out: 8, outstanding: { number: 8, handed_out_at: NOW - 660_000, age_s: 660, void: true } } }));
    const late = (await screen.findByText(/handed out 11 min ago/)).closest('.status') as HTMLElement;
    expect(late.className).toBe('status tone-warn');
    expect(late.textContent).toContain('void: the next sync takes a new one');
  });

  it('the Discrepancies table links each ticket’s history, strikes what Baton had, and draws a hostile git value as text', async () => {
    draw(view({ discrepancies: { since: NOW - 7 * 86_400_000, by_kind: { regressed: 1, 'dispatch-refused': 1 }, truncated: false, rows: [
      { id: 9, ticket_id: 'docs:R3-425', claim_id: 4, at: NOW - 3_600_000, sub: 'regressed', baton: { station: 'reviewed' }, git: HOSTILE, observation: 7 },
      { id: 8, ticket_id: null, claim_id: null, at: NOW - 7_200_000, kind: 'dispatch-refused', workflow: 'sync', reason: 'forbidden by the forge' },
    ] } }));
    const table = await screen.findByRole('table', { name: 'Discrepancies' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Kind', 'Ticket', 'Baton had', 'Git showed', 'Observation', 'Age']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByRole('link', { name: 'docs:R3-425' }).getAttribute('href')).toBe('/repositories/docs/tickets/R3-425#history');
    const had = rows[0].querySelector('.had') as HTMLElement;
    expect(had.textContent).toBe('{"station":"reviewed"}');
    expect(rows[0].textContent).toContain(HOSTILE);
    expect(document.querySelector('img')).toBeNull();
    expect(rows[1].textContent).toContain('dispatch-refused');
    expect(rows[1].textContent).toContain('forbidden by the forge');
    expect(rows[1].querySelector('.had')).toBeNull();
    // Cards at phone width: each cell carries its heading.
    expect(rows[0].querySelector('td[data-label="Git showed"]')).not.toBeNull();
  });

  it('?since= round-trips: the URL names the window, the read gets its instant, the default sends nothing', async () => {
    expect(sinceOf('7d', NOW)).toBeNull();
    expect(sinceOf('1d', Date.parse('2026-11-20T12:59:59.999Z'))).toBe('2026-11-19T13:00:00.000Z');
    expect(sinceOf('30d', Date.parse('2026-11-20T12:00:00.000Z'))).toBe('2026-10-21T12:00:00.000Z');
    expect(sinceOf('nope', NOW)).toBeNull();
    goTo('/repositories/docs/sync?since=1d');
    const { calls } = draw(view(), { [`${PATH}?since=${encodeURIComponent('2026-11-19T13:00:00.000Z')}`]: view() });
    await screen.findByRole('heading', { name: 'Discrepancies' });
    const reads = () => calls.filter((c) => c.method === 'GET' && c.path.startsWith(PATH)).map((c) => c.path);
    expect(reads()).toEqual([`${PATH}?since=${encodeURIComponent('2026-11-19T13:00:00.000Z')}`]);
    expect(screen.getByRole('tab', { name: '24 hours' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: '7 days' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    await waitFor(() => expect(reads().at(-1)).toBe(PATH));
    fireEvent.click(screen.getByRole('tab', { name: '30 days' }));
    await waitFor(() => expect(window.location.search).toBe('?since=30d'));
  });
});
