// conditions.test.tsx — B-219: the Conditions list and the Resolve page, on B-195's reads.
// The list draws `repo.needs-you`: open conditions in the read's order with the questions
// among them, each kind under its plain name (a course's own type under its own); restarts are
// controls only where the read's `allowed` names one, else text; a person leg's options are
// buttons never — the CLI line and the read's reason are text; an interaction request's link
// is a link only on an allowed session host; the listings that are not conditions yet are
// drawn under their names; `?type=`, `?ticket=` and `?open=0` are the URL's. The Resolve page
// draws one condition, says when it closed after a poll, keeps its path signed out, and
// `/conditions/{id}` finds the page in the tree. A hostile string stays text everywhere.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ACTIONS, actionsFor } from '../../src/core/actions';
import { SCREENS } from '../../src/core/screens';
import { ConditionScreen } from '../../src/dashboard/screens/conditions/ConditionScreen';
import { ConditionsScreen, LISTINGS } from '../../src/dashboard/screens/conditions/ConditionsScreen';
import { conditionAddress } from '../../src/dashboard/screens/conditions/ConditionRedirect';
import { kindOf } from '../../src/dashboard/screens/conditions/kit';
import type { Condition, NeedsYou, Question } from '../../src/dashboard/screens/conditions/types';
import type { Action } from '../../src/dashboard/lib/types';
import type { ScreenProps } from '../../src/dashboard/screens/contract';
import { goTo, mockFetch, refuse, renderApp, renderWithShell, repoList, repoRow, resetShell } from './helpers';

const HOSTILE = '<img src=x onerror=alert(1)>';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const LIST = SCREENS.find((s) => s.id === 'repository/conditions')!;
const ONE = SCREENS.find((s) => s.id === 'repository/conditions/{condition}')!;
const repos = repoList([repoRow('docs')]);
const actions = actionsFor('administrator') as Action[];

const condition = (id: number, over: Partial<Condition> = {}): Condition => ({
  condition_id: id, ticket_id: 'docs:A', leg: 'leg-a', run_id: 'r_1', type: 'hitl', disposition: 'suspend', severity: 'normal', raised_at: NOW - 60_000, url: null,
  restarts: { retry: 'run it again', park: 'hold it' }, default: 'retry', outcome: 'open', closed_at: null, closed_how: null, resolve_url: `/repositories/docs/conditions/${id}`, allowed: [], ...over,
});
const question = (over: Partial<Question> = {}): Question => ({
  ticket_id: 'docs:P', leg: 'leg-p', asks: 'owner', title: 'P — a fixture', question_id: 'q-1', url: null, severity: 'high',
  options: [{ id: 'ship', reached: 'station-a', action: 'moves the ticket to ‘station-a’' }, { id: 'hold', reached: 'station-b' }],
  answerable: false, why: 'an administrator’s session answers no person leg', human_only: false, ...over,
});
const needs = (over: Partial<NeedsYou> = {}): NeedsYou => ({
  repository: 'docs', conditions: [], questions: [], listings: {}, held_posts: 0, elsewhere: ['keys', 'capacity'], not_built: { resolve: 'B-56' }, server_time: NOW, ...over,
});
const props = (screen: typeof LIST, params: Record<string, string>): ScreenProps => ({ screen, params, repository: repoRow('docs'), repos, role: 'administrator' });
const renderList = (answer: NeedsYou, extra: Record<string, object> = {}, acts: Action[] = actions) => {
  const fetched = mockFetch({ '/v1/repositories/docs/needs-you': answer, ...extra });
  const view = renderWithShell(<ConditionsScreen {...props(LIST, { repository: 'docs' })} />, { actions: acts, repos, now: NOW });
  return { ...fetched, ...view };
};
const rowsOf = () => [...document.querySelectorAll('.needs-row')] as HTMLElement[];

afterEach(() => {
  cleanup();
  resetShell();
});

describe('the Conditions list (B-219 item 1)', () => {
  it('draws the read’s order, the questions among the conditions of their severity, each kind under its name', async () => {
    renderList(needs({
      conditions: [condition(3, { severity: 'critical', type: 'baton.retries', restarts: null }), condition(1, { type: 'ask.owner' }), condition(2, { type: 'interact', disposition: 'notify', restarts: null, url: 'https://claude.ai/s/r_1' })],
      questions: [question()],
    }));
    await screen.findByRole('heading', { name: 'Needs you' });
    const kinds = rowsOf().map((r) => r.querySelector('.needs-kind')!.textContent);
    expect(kinds).toEqual(['■Retries exhausted', '?Question', '▲ask.owner', '◆Interaction request']);
    // A name is tied to the type that renders it; a course's own type is its own name.
    expect(kindOf({ type: 'hitl.review', disposition: 'suspend' }).name).toBe('Waiting on a person');
    expect(kindOf({ type: 'ask.owner', disposition: 'suspend' }).name).toBeNull();
    const first = within(rowsOf()[0]);
    expect(first.getByRole('link', { name: 'docs:A' }).getAttribute('href')).toBe('/repositories/docs/tickets/A');
    expect(first.getByRole('link', { name: 'Resolve page' }).getAttribute('href')).toBe('/repositories/docs/conditions/3');
    expect(first.getByText('critical')).toBeDefined();
    expect(screen.getByText(/whole instance/).textContent).toContain('keys, capacity');
  });

  it('restarts are text where the read allows none, and a control only where it names one', async () => {
    const resolve: Action = {
      id: 'ticket.resolve', summary: 'Resolve: restart the ticket.', effect: 'write', http: { method: 'POST', path: '/v1/ui/conditions/{condition}/resolve' },
      callers: [{ principal: 'session', scope: 'instance', roles: ['administrator'] }],
      input: { type: 'object', required: ['restart'], properties: { restart: { type: 'string', enum: ['retry', 'park'] } } }, ui: { view: ['repository/conditions/{condition}'] },
    };
    const { calls } = renderList(needs({ conditions: [condition(1), condition(2, { allowed: ['ticket.resolve'] })] }), { 'POST /v1/ui/conditions/2/resolve': { ok: true } }, [...actions, resolve]);
    await screen.findByRole('heading', { name: 'Needs you' });
    const [denied, allowed] = rowsOf();
    // Both rows name the restarts as text; the default is marked.
    expect(denied.querySelector('.needs-restarts')!.textContent).toBe('retry (default) — run it againpark — hold it');
    expect(within(denied).queryByRole('button')).toBeNull();
    expect(screen.getByText(/Resolving a condition by one of its restarts is not built yet/).textContent).toContain('B-56');
    // The registry places it, and the read allows it on this one alone.
    fireEvent.click(within(allowed).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/v1/ui/conditions/2/resolve', body: { restart: 'retry' } });
    // The real registry has no such entry: nothing is drawn for a session today.
    expect(ACTIONS.some((a) => a.ui?.view.includes('repository/conditions/{condition}'))).toBe(false);
  });

  it('a person leg’s options are text with the CLI line and the read’s reason, never buttons', async () => {
    const { calls } = renderList(needs({ questions: [question(), question({ ticket_id: 'docs:Q', answerable: true, why: null, human_only: true })] }));
    await screen.findByRole('heading', { name: 'Needs you' });
    const [denied, mine] = rowsOf();
    expect(within(denied).queryByRole('button')).toBeNull();
    expect([...denied.querySelectorAll('.cli')].map((c) => c.textContent)).toEqual(['baton decision answer -i KEY docs:P ship', 'baton decision answer -i KEY docs:P hold']);
    expect(denied.querySelector('.needs-options')!.textContent).toContain('moves the ticket to ‘station-a’');
    expect(denied.querySelector('.needs-why')!.textContent).toBe('This page cannot answer it — an administrator’s session answers no person leg. KEY is an owner key of this repository, or a human-only key.');
    // Even where the read says the caller may answer, the page posts nothing: the line is the caller's to run.
    expect(within(mine).queryByRole('button')).toBeNull();
    expect(mine.querySelector('.needs-why')!.textContent).toBe('Your key may answer: run the line where the key is.');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('an interaction request’s link is a link on an allowed session host, text on any other', async () => {
    renderList(needs({ conditions: [
      condition(1, { type: 'interact', disposition: 'notify', restarts: null, url: 'https://claude.ai/s/r_1' }),
      condition(2, { type: 'interact', disposition: 'notify', restarts: null, url: 'https://evil.example/s/r_2' }),
      condition(3, { url: 'https://evil.example/question' }),
    ] }));
    await screen.findByRole('heading', { name: 'Needs you' });
    const [ok, bad, asked] = rowsOf();
    const link = within(ok).getByRole('link', { name: /Open session/ });
    expect([link.getAttribute('href'), link.getAttribute('rel'), link.textContent]).toEqual(['https://claude.ai/s/r_1', 'noopener noreferrer', 'Open session (claude.ai)']);
    expect(within(bad).queryByRole('link', { name: /Open session/ })).toBeNull();
    expect(bad.querySelector('.unlinked')!.textContent).toBe('Open session');
    // A condition's own url on a host outside the repository's web_base is text too.
    expect(asked.querySelector('.unlinked')!.textContent).toBe('where it is asked');
    expect(asked.querySelector('a.ext')).toBeNull();
  });

  it('draws the listings that are not conditions yet under their names, and a hostile value as text', async () => {
    renderList(needs({
      conditions: [condition(1, { ticket_id: HOSTILE, type: HOSTILE, leg: HOSTILE, restarts: { [HOSTILE]: HOSTILE } })],
      questions: [question({ title: HOSTILE, asks: HOSTILE, options: [{ id: HOSTILE, reached: 'x', action: HOSTILE }], why: HOSTILE })],
      listings: {
        held_items: [{ ticket_id: 'docs:H', hold_reason: HOSTILE, set_at: NOW - 3_600_000, attempts: [] }],
        unconfirmed: [{ id: 7, ticket_id: 'docs:U', runner_id: 2, ended_at: NOW - 120_000, end_reason: 'done' }],
        adoptions: [{ ticket_id: 'docs:L', session_name: 's-1', requested_at: NOW - 1000 }],
        blocked_capability: [],
        something_new: [{ a: 1 }],
      },
      held_posts: 2,
    }));
    await screen.findByRole('heading', { name: 'Also waiting' });
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain(HOSTILE);
    const also = screen.getByRole('heading', { name: 'Also waiting' }).closest('section')!;
    const names = [...also.querySelectorAll('.needs-kind')].map((k) => k.textContent);
    expect(names).toEqual(['◆Unconfirmed', '‖Held', '▲Adoption asked for']);
    expect(within(also as HTMLElement).getByRole('link', { name: 'docs:H' }).getAttribute('href')).toBe('/repositories/docs/tickets/H');
    expect(within(also as HTMLElement).getByRole('link', { name: 'Sync' }).getAttribute('href')).toBe('/repositories/docs/sync');
    // A listing this page has no name for is named as the read names it, never dropped.
    expect(also.textContent).toContain('something_new (1)');
    expect(screen.getByRole('link', { name: /2 held on Sync/ }).getAttribute('href')).toBe('/repositories/docs/sync');
    // Every listing the page names is one the read can serve.
    expect(LISTINGS.map((l) => l.key).sort()).toEqual(['adoptions', 'bars_mismatch', 'blocked_capability', 'course_changed', 'courses_refused', 'fence_pending', 'held_items', 'input_missing', 'input_version',
      'no_owner_channel', 'policy', 'pool_unclaimed', 'regressed', 'scope', 'stale_skills', 'unacknowledged_releases', 'unconfirmed', 'unsigned_control']);
  });

  it('?type= and ?ticket= filter and stay in the URL; ?open=0 reads the whole list', async () => {
    goTo('/repositories/docs/conditions?type=interact');
    const { calls } = renderList(
      needs({ conditions: [condition(1, { type: 'interact.review', disposition: 'notify' }), condition(2, { type: 'hitl', ticket_id: 'docs:B' })], questions: [question()] }),
      { '/v1/repositories/docs/conditions': { conditions: [condition(9, { outcome: 'closed', closed_at: NOW - 5000, type: 'warning' })], cursor: null } },
    );
    await screen.findByRole('heading', { name: 'Needs you' });
    expect(rowsOf().map((r) => r.querySelector('.needs-kind')!.textContent)).toEqual(['◆Interaction request']);
    expect((screen.getByLabelText('Condition type') as HTMLInputElement).value).toBe('interact');
    fireEvent.change(screen.getByLabelText('Condition type'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Ticket'), { target: { value: 'B' } });
    await waitFor(() => expect(window.location.search).toBe('?ticket=B'));
    expect(rowsOf().map((r) => within(r).getAllByRole('link')[0].textContent)).toEqual(['docs:B']);
    // Closed conditions sit behind the toggle, and cost a read only then.
    expect(calls.some((c) => c.path.startsWith('/v1/repositories/docs/conditions'))).toBe(false);
    fireEvent.click(screen.getByLabelText('Show closed conditions'));
    await waitFor(() => expect(window.location.search).toBe('?ticket=B&open=0'));
    const table = await screen.findByRole('table', { name: 'Every condition of the repository' });
    expect(within(table).getByRole('link', { name: '9' }).getAttribute('href')).toBe('/repositories/docs/conditions/9');
    expect(calls.find((c) => c.path.startsWith('/v1/repositories/docs/conditions'))!.path).toBe('/v1/repositories/docs/conditions?ticket=B');
  });

  it('says so when nothing waits', async () => {
    renderList(needs());
    expect(await screen.findByText('Nothing needs you right now.')).toBeDefined();
    expect(screen.getByText('Nothing else is waiting.')).toBeDefined();
  });
});

describe('the Resolve page (B-219 item 2)', () => {
  const shown = (over: Record<string, unknown> = {}) => ({
    ...condition(4, { severity: 'high' }), repository: 'docs', claim_id: 9,
    ticket: { ticket_id: 'docs:A', title: 'A — a fixture', course_id: 'course-a', station: 'station-a', next_leg: 'leg-b' }, unblocks: ['docs:B'], not_built: { resolve: 'B-56' }, ...over,
  });
  const renderOne = (answer: () => object) => {
    const fetched = mockFetch({ '/v1/repositories/docs/conditions/4': () => ({ body: answer() }) });
    const view = renderWithShell(<ConditionScreen {...props(ONE, { repository: 'docs', condition: '4' })} />, { actions, repos, now: NOW });
    return { ...fetched, ...view };
  };

  it('draws the condition, the ticket’s position, the restarts and what waits on it — and says when it closed after a poll', async () => {
    let closed = false;
    const { store } = renderOne(() => shown(closed ? { outcome: 'closed', closed_at: NOW, closed_how: 'resolved', unblocks: [] } : {}));
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('▲Waiting on a personhigh');
    expect(document.querySelector('.page-sub')!.textContent).toBe('Condition 4 on docs:A — A — a fixture');
    expect(document.querySelector('.kv')!.textContent).toContain('stands atstation-a · next leg leg-b');
    expect(document.querySelector('.resolve-restarts')!.textContent).toBe('retry (default) — run it againpark — hold it');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/is not built yet/).textContent).toContain('B-56');
    const waiting = screen.getByRole('heading', { name: 'Waiting on its ticket' }).closest('section') as HTMLElement;
    expect(within(waiting).getByRole('link', { name: 'docs:B' }).getAttribute('href')).toBe('/repositories/docs/tickets/B');
    expect(screen.queryByText(/This condition is closed/)).toBeNull();
    closed = true;
    await act(() => store.refresh());
    expect((await screen.findByText(/This condition is closed/)).textContent).toContain('closed (resolved). Nothing waits on it.');
    expect(screen.queryByText(/is not built yet/)).toBeNull();
  });

  it('an interaction request shows its session link and takes no restart; a hostile value is text', async () => {
    renderOne(() => shown({ type: 'interact', disposition: 'notify', restarts: null, default: null, url: 'https://claude.ai/s/r_1', leg: HOSTILE, ticket: { ticket_id: 'docs:A', title: HOSTILE, station: HOSTILE } }));
    const link = await screen.findByRole('link', { name: /Open session/ });
    expect(link.getAttribute('href')).toBe('https://claude.ai/s/r_1');
    expect(screen.getByText(/takes no restart/)).toBeDefined();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.page-sub')!.textContent).toContain(HOSTILE);
  });

  it('another repository’s id is "No such condition" with the id as text', async () => {
    mockFetch({ '/v1/repositories/docs/conditions/4': () => refuse('not-found') });
    renderWithShell(<ConditionScreen {...props(ONE, { repository: 'docs', condition: '4' })} />, { actions, repos });
    expect((await screen.findByRole('heading', { name: 'No such condition' })).parentElement!.textContent).toContain('4');
  });
});

describe('signed out, and the address of a notification (B-219, B-195)', () => {
  it('signed out, the Resolve page shows sign-in in place and keeps its path', async () => {
    mockFetch({ '/v1/repositories': () => refuse('unauthenticated'), '/v1/actions': () => refuse('unauthenticated') });
    renderApp('/repositories/docs/conditions/4');
    await waitFor(() => expect(document.querySelector('.signin')).not.toBeNull());
    expect(window.location.pathname).toBe('/repositories/docs/conditions/4');
  });

  it('/conditions/{id} finds the condition’s page in the tree; an id the session does not hold is not found', async () => {
    expect([conditionAddress('/conditions/12'), conditionAddress('/conditions/a/b'), conditionAddress('/repositories/docs/conditions/12')]).toEqual(['12', null, null]);
    mockFetch({
      '/v1/repositories': repos, '/v1/actions': { actions: [] },
      '/v1/conditions/12': { condition_id: 12, repository: 'docs', path: 'https://evil.example/' },
      '/v1/repositories/docs/conditions/12': { ...condition(12), repository: 'docs', ticket: null, unblocks: [] },
      '/v1/conditions/13': () => refuse('not-found'),
    });
    renderApp('/conditions/12');
    // The page is built from the read's two ids, never from the path it spelt.
    await waitFor(() => expect(window.location.pathname).toBe('/repositories/docs/conditions/12'));
    cleanup();
    renderApp('/conditions/13');
    expect((await screen.findByRole('heading', { name: 'No such condition' })).parentElement!.textContent).toContain('13');
    expect(window.location.pathname).toBe('/conditions/13');
  });
});
