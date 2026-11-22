// ticket-page.test.tsx — B-210 and B-222: the ticket's page from fixture reads. Every section
// draws its read; a log directory, a `git:` URI and a session link off `session_hosts` are
// text, an `https://` URI under `web_base` is a link; the route and adopt lines are text; a
// hostile title is text. The controls are the registry's: an owner's entries draw hold, Stop
// and the acknowledgement and no force-reap; an administrator's draw force-reap, the fence
// clear and the completion's confirm and release too; unhold only where the read's `allowed`
// names it; Stop confirms with `to_runner_id`; a destructive entry opens the confirm dialog.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ACTIONS, actionsFor } from '../../src/core/actions';
import { legsOf } from '../../src/dashboard/screens/tickets/TicketPage';
import { ticketRowIds } from '../../src/dashboard/screens/tickets/TicketControls';
import type { TicketShow } from '../../src/dashboard/screens/tickets/types';
import { mockFetch, renderApp, repoList, repoRow, resetShell, type Route } from './helpers';

const HOSTILE = '<img src=x onerror=alert(1)>';
const NOW = Date.now();
const HOUR = 3_600_000;
const BASE = '/v1/repositories/docs/tickets/T-1';

afterEach(() => {
  cleanup();
  resetShell();
});

const show = (over: Partial<TicketShow> = {}): TicketShow => ({
  ticket_id: 'docs:T-1', repository: 'docs', course_id: 'course-a', course: 'course-a', title: 'The first ticket', path: 'tickets/T-1.mdx', tier: 'routine',
  requires: ['cap-a', 'cap-x'], requires_unmet: ['cap-x'], tags: ['tag-a'], order: null, parent: 'docs:T-0', expedite: false,
  children: [{ ticket_id: 'docs:T-2', station: 'station-a' }],
  station: { station: 'station-b', path: [{ leg: 'leg-a', reached: 'station-b' }], next_leg: 'leg-b', to_end: 2 },
  position: { station: 'station-b', path_len: 1, next_leg: 'leg-b', next_source: 'course' },
  last_written_by: { pusher: 'a-person', commit: 'abcdef0123456789', at: NOW - HOUR, human: true },
  state: 'running', reasons: [],
  detail: { claim_id: 7, runner_id: 1, hostname: 'host-one', session_name: 'sess-one', leg: 'leg-b', since: NOW - HOUR, lease_ends_at: NOW + HOUR, stalled: false, alive: true, condition_wait: null },
  claim: {
    claim_id: 7, runner_id: 1, hostname: 'host-one', session_name: 'sess-one', leg: 'leg-b', run_id: 'r_01RUN', claimed_at: NOW - HOUR, lease_ends_at: NOW + HOUR,
    deadline_at: NOW + 2 * HOUR, attempt: 2, max_runs: 3, next_backoff_until: null, session_url: 'https://claude.ai/code/session_1', log_dir: '/var/log/baton/T-1/leg-b', alive: true, stalled: false,
  },
  attempts: [{ run: 1, claim_id: 5, runner_id: 2, hostname: 'host-two', started_at: NOW - 5 * HOUR, ended_at: NOW - 4 * HOUR, end_reason: 'released:cannot-finish:transient', detail: 'the build host was down' }],
  overrides: { expedite: true, hold: null },
  conditions: [{ condition_id: 31, type: 'x.wait', severity: 'high', leg: 'leg-b', restarts: ['retry', 'park'] }],
  scope: [{ id: 12, kind: 'scope-exceeded', target: 'example-org/other', ref: 'refs/heads/x', at: NOW - HOUR }],
  fence: null,
  resume: { end_reason: 'released:cannot-finish:transient', ended_at: NOW - 4 * HOUR, branches: ['claude/T-1-x'], prs: ['https://github.com/example-org/docs/pull/9'] },
  web_url: 'https://github.com/example-org/docs/blob/main/tickets/T-1.mdx',
  allowed: [],
  ...over,
});

const READS: Record<string, Route> = {
  [`${BASE}/blocks`]: { blocked: false, blocks: [{ kind: 'ticket', ref: 'docs:T-9', since: NOW - HOUR }, { kind: 'capability', ref: 'cap-x', leg: 'leg-b', since: NOW - HOUR, until: NOW + HOUR }], other: [{ kind: 'claimed', detail: { claim_id: 7 } }] },
  [`${BASE}/children`]: { children: [{ ticket_id: 'docs:T-2', station: 'station-a', blocked: true }, { ticket_id: 'docs:T-3', station: null, blocked: false, closed: { as: 'done', closed_at: NOW - HOUR } }] },
  [`${BASE}/history`]: { rows: [
    { id: 9, at: NOW - HOUR, kind: 'leg-started', leg: 'leg-b', run: 2, run_id: 'r_01RUN', detail: null, rationale: { ranking: HOSTILE } },
    { id: 8, at: NOW - 2 * HOUR, kind: 'leg-finished', leg: 'leg-a', run: 1, reached: 'station-b', next_leg: 'leg-b', detail: {
      inputs: [{ name: 'spec', uri: 'git:example-org/docs@abc:spec.md', digest: 'sha256:1111' }],
      outputs: [{ name: 'result', uri: 'https://github.com/example-org/docs/pull/9' }, { name: 'elsewhere', uri: 'https://evil.example/x' }, { name: 'blob', uri: 's3://bucket/key' }],
    } },
  ], next_before: 8 },
  [`${BASE}/history?before=8`]: { rows: [{ id: 3, at: NOW - 9 * HOUR, kind: 'position-confirmed', reached: 'station-a', detail: { note: HOSTILE } }] },
  [`${BASE}/legs/leg-a/runs`]: { runs: [{ run: 1, claim: 5, runner: 2, leg: 'leg-a', run_id: 'r_01OLD', started_at: NOW - 5 * HOUR, ended_at: NOW - 4 * HOUR, end: 'done', session_url: 'https://evil.example/session', log_dir: '/var/log/baton/T-1/leg-a', transcripts: [{ repo: 'example-org/sessions', path: 'a/b.jsonl' }] }] },
  [`${BASE}/legs/leg-b/runs`]: { runs: [{ run: 1, claim: 7, runner: 1, leg: 'leg-b', run_id: 'r_01RUN', started_at: NOW - HOUR, ended_at: null, end: null, session_url: 'https://claude.ai/code/session_1' }] },
};

function serve(ticket: TicketShow, role: 'administrator' | 'owner' = 'administrator', routes: Record<string, Route> = {}) {
  return mockFetch({
    '/v1/repositories': repoList([repoRow('docs')], role),
    '/v1/actions': { actions: actionsFor(role, { ownsRepository: true }) },
    [BASE]: ticket,
    ...READS,
    ...routes,
  });
}
const section = (name: string) => screen.getByRole('region', { name }) as HTMLElement;
const controlNames = () => [...document.querySelectorAll('.tp-controls button, .tp-controls summary')].map((b) => b.textContent);

describe('the ticket page’s sections (B-210)', () => {
  it('reads the legs the path names, the claim’s and the queued one, each once', () => {
    expect(legsOf(show())).toEqual(['leg-a', 'leg-b']);
    expect(legsOf(show({ station: null, claim: null, position: null }))).toEqual([]);
  });

  it('draws the head, the position with the CLI lines, the claim and the attempts', async () => {
    serve(show());
    renderApp('/repositories/docs/tickets/T-1');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('docs:T-1 The first ticket');
    const head = document.querySelector('.kv') as HTMLElement;
    expect(head.querySelector('.status-label')!.textContent).toBe('running');
    expect(head.textContent).toContain('course-a');
    expect(head.querySelector('.chip-unmet')!.textContent).toBe('▲ cap-x · no live runner');
    expect(within(head).getByRole('link', { name: 'docs:T-0' }).getAttribute('href')).toBe('/repositories/docs/tickets/T-0');
    // The one outward link is built by the server from web_base and passes the client's rule.
    const forge = within(head).getByRole('link', { name: /tickets\/T-1\.mdx/ });
    expect([forge.getAttribute('href'), forge.textContent]).toEqual(['https://github.com/example-org/docs/blob/main/tickets/T-1.mdx', 'tickets/T-1.mdx (github.com)']);
    expect(head.textContent).toContain('a-person at abcdef01');
    expect(head.textContent).toContain('human');

    const position = section('Position');
    expect(position.textContent).toContain('leg-a → station-b');
    expect(position.textContent).toContain('leg-b · named by course');
    // Route and adopt are the CLI's (Decision 2a): lines of text, never a button.
    expect([...position.querySelectorAll('code.cli')].map((c) => c.textContent)).toEqual(['baton ticket route T-1 <leg>', 'baton ticket adopt T-1 …']);
    expect(within(position).queryByRole('button')).toBeNull();

    const claim = section('Claim');
    expect(within(claim).getAllByRole('link', { name: /host-one/ })[0].getAttribute('href')).toBe('/repositories/docs/runners/1');
    expect(claim.textContent).toContain('leg-b · run r_01RUN');
    expect(claim.querySelector('.lease')!.getAttribute('aria-label')).toMatch(/^lease: (1 h|60 min) left$/);
    expect(claim.textContent).toContain('2 of 3');
    // R-BTN-113: a session link on session_hosts is a link; R-BTN-128: a log directory is text.
    expect(within(claim).getByRole('link', { name: /claude\.ai\/code\/session_1/ }).getAttribute('href')).toBe('https://claude.ai/code/session_1');
    expect(claim.textContent).toContain('/var/log/baton/T-1/leg-b');
    expect([...claim.querySelectorAll('a')].some((a) => (a.getAttribute('href') ?? '').includes('/var/log'))).toBe(false);
    expect([...claim.querySelectorAll('code.cli')].map((c) => c.textContent)).toEqual(['baton leg log T-1 leg-b']);
    const attempts = within(claim).getByRole('table', { name: 'Earlier attempts' });
    expect(attempts.textContent).toContain('released:cannot-finish:transient');
    expect(attempts.textContent).toContain('the build host was down');
    expect(claim.querySelector('.tp-resume')!.textContent).toContain('claude/T-1-x');
  });

  it('draws why it cannot move, the conditions, the scope findings, the children and the leg runs', async () => {
    serve(show());
    renderApp('/repositories/docs/tickets/T-1');
    const blocks = await screen.findByRole('table', { name: 'Blocks' });
    expect(within(blocks).getByRole('link', { name: 'docs:T-9' }).getAttribute('href')).toBe('/repositories/docs/tickets/T-9');
    expect(blocks.textContent).toContain('cap-x');
    expect(blocks.textContent).toContain('every leg');
    expect(screen.getByRole('table', { name: 'What else keeps it from being offered' }).textContent).toContain('claimed');
    expect(section('Why it cannot move').textContent).toContain('prerequisites is not built yet (B-10)');

    const conditions = screen.getByRole('table', { name: 'Open conditions' });
    expect(within(conditions).getByRole('link', { name: '31' }).getAttribute('href')).toBe('/repositories/docs/conditions/31');
    expect(conditions.textContent).toContain('x.wait');
    const scope = screen.getByRole('table', { name: 'Open scope findings' });
    expect(scope.textContent).toContain('example-org/other');
    expect(scope.textContent).toContain('refs/heads/x');

    const children = await screen.findByRole('table', { name: 'Children' });
    expect(within(children).getByRole('link', { name: 'docs:T-2' }).getAttribute('href')).toBe('/repositories/docs/tickets/T-2');
    expect(children.textContent).toContain('closed as done');
    expect(within(children).getByText('blocked')).toBeDefined();

    const runs = await screen.findByRole('table', { name: 'Leg runs' });
    await waitFor(() => expect(runs.querySelectorAll('tbody tr').length).toBe(2));
    // A session link off session_hosts is text; the log directory and the transcript are text.
    expect(runs.textContent).toContain('https://evil.example/session');
    expect([...runs.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h?.startsWith('http'))).toEqual(['https://claude.ai/code/session_1']);
    expect(runs.textContent).toContain('/var/log/baton/T-1/leg-a');
    expect(runs.textContent).toContain('example-org/sessions:a/b.jsonl');
  });

  it('pages the history by before, and draws pointers: a git: URI as text, an https URI a link only under the link rule', async () => {
    const { calls } = serve(show());
    renderApp('/repositories/docs/tickets/T-1');
    const history = await screen.findByRole('table', { name: 'History' });
    expect(history.querySelectorAll('tbody tr').length).toBe(2);
    expect(history.textContent).toContain('git:example-org/docs@abc:spec.md');
    expect(history.textContent).toContain('sha256:1111');
    expect(history.textContent).toContain('s3://bucket/key');
    const links = [...history.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://github.com/example-org/docs/pull/9']);
    expect(history.textContent).toContain('https://evil.example/x');
    expect(history.querySelector('pre.json')?.textContent).toContain(`"ranking": "${HOSTILE}"`);
    expect(history.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    await waitFor(() => expect(history.querySelectorAll('tbody tr').length).toBe(3));
    expect(calls.some((c) => c.path === `${BASE}/history?before=8`)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Earlier' })).toBeNull();
    expect(history.textContent).toContain(HOSTILE);
    expect(document.querySelector('img')).toBeNull();
  });

  it('draws a hostile title as text, and "No such ticket" for an id the repository does not hold', async () => {
    serve(show({ title: HOSTILE }));
    const page = renderApp('/repositories/docs/tickets/T-1');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(`docs:T-1 ${HOSTILE}`);
    expect(document.querySelector('img')).toBeNull();
    page.unmount();
    resetShell();
    serve(show(), 'administrator', { [BASE]: () => ({ status: 404, body: { ok: false, code: 'not-found', message: 'docs:T-1 is not on the board' } }) });
    renderApp('/repositories/docs/tickets/T-1');
    expect(await screen.findByText(/No such ticket/)).toBeDefined();
  });
});

describe('the ticket page’s controls (B-222)', () => {
  const VIEW = ACTIONS.filter((a) => a.ui?.view.includes('repository/tickets/{ticket}')).map((a) => a.id);

  it('the registry places hold, unhold, expedite, Stop, force-reap, the fence clear, confirm, release and the acknowledgement here', () => {
    for (const id of ['ticket.hold', 'ticket.unhold', 'ticket.expedite', 'leg.stop', 'claim.force-reap', 'claim.fence-clear', 'claim.confirm', 'claim.release', 'scope.resolve']) expect(VIEW).toContain(id);
  });

  it('the ticket’s row leaves out unhold unless allowed, the claim’s entries without a claim, and those with a row of their own', () => {
    const base = ticketRowIds(VIEW, { allowed: [], claim: show().claim });
    expect(base).toContain('ticket.hold');
    expect(base).toContain('leg.stop');
    expect(base).toContain('claim.force-reap');
    for (const id of ['ticket.unhold', 'claim.confirm', 'claim.release', 'claim.fence-clear', 'scope.resolve']) expect(base).not.toContain(id);
    expect(ticketRowIds(VIEW, { allowed: ['ticket.unhold'], claim: null })).toContain('ticket.unhold');
    expect(ticketRowIds(VIEW, { allowed: [], claim: null })).not.toContain('leg.stop');
  });

  it('an owner’s entries draw hold, expedite, Stop and the acknowledgement, and no force-reap', async () => {
    serve(show(), 'owner');
    renderApp('/repositories/docs/tickets/T-1');
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(controlNames().length).toBeGreaterThan(0));
    const names = controlNames().join(' | ');
    expect(names).toMatch(/Hold a ticket/);
    expect(names).toMatch(/Stop/);
    expect(names).toMatch(/expedite/);
    expect(names).not.toMatch(/Force-reap/);
    expect(names).not.toMatch(/Lift a ticket/);
    expect(within(screen.getByRole('table', { name: 'Open scope findings' })).getByRole('button', { name: /Resolve a scope finding/ })).toBeDefined();
  });

  it('an administrator’s draw force-reap too; unhold appears only with allowed', async () => {
    serve(show({ state: 'held', reasons: [], detail: { set_by: 'owner:abc', reason: 'owner', since: NOW }, claim: null, overrides: { expedite: false, hold: { set_by: 'owner:abc', reason: 'owner', since: NOW } }, allowed: ['ticket.unhold'] }));
    const held = renderApp('/repositories/docs/tickets/T-1');
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(controlNames().join(' | ')).toMatch(/Lift a ticket’s hold/));
    // No live claim: nothing to stop and nothing to reap.
    expect(controlNames().join(' | ')).not.toMatch(/Stop|Force-reap/);
    held.unmount();
    resetShell();
    serve(show());
    renderApp('/repositories/docs/tickets/T-1');
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(controlNames().join(' | ')).toMatch(/Force-reap a live claim…/));
    expect(controlNames().join(' | ')).not.toMatch(/Lift a ticket’s hold|Confirm an unconfirmed|Clear a fenced/);
  });

  it('Stop confirms with to_runner_id', async () => {
    const { calls } = serve(show(), 'owner', { 'POST /v1/ui/messages': { ok: true } });
    renderApp('/repositories/docs/tickets/T-1');
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop…' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const sent = calls.find((c) => c.method === 'POST')!;
    expect([sent.path, sent.body]).toEqual(['/v1/ui/messages', { to_runner_id: 1, kind: 'release', confirm: true, payload: { ticket_id: 'docs:T-1', reason: 'requested' } }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hold sends one click to the ticket’s override route; a refusal is drawn beside it as text', async () => {
    const { calls } = serve(show(), 'owner', { 'POST /v1/ui/overrides/docs%3AT-1': () => ({ status: 409, body: { ok: false, code: 'conflict', message: HOSTILE } }) });
    renderApp('/repositories/docs/tickets/T-1');
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(await screen.findByRole('button', { name: 'Hold a ticket' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const sent = calls.find((c) => c.method === 'POST')!;
    expect([sent.path, sent.body]).toEqual(['/v1/ui/overrides/docs%3AT-1', { hold: true }]);
    expect((await screen.findByRole('alert')).textContent).toContain(HOSTILE);
    expect(document.querySelector('img')).toBeNull();
  });

  it('force-reap opens the confirm dialog and sends confirm: true to the live claim', async () => {
    const { calls } = serve(show(), 'administrator', { 'POST /v1/ui/claims/7/reap': { ok: true, fence_pending: true } });
    renderApp('/repositories/docs/tickets/T-1');
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(await screen.findByRole('button', { name: 'Force-reap a live claim…' }));
    const dialog = await screen.findByRole('dialog');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    const go = within(dialog).getAllByRole('button').find((b) => !/cancel/i.test(b.textContent ?? ''))!;
    fireEvent.click(go);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const sent = calls.find((c) => c.method === 'POST')!;
    expect([sent.path, sent.body]).toEqual(['/v1/ui/claims/7/reap', { confirm: true }]);
  });

  it('confirm and release are drawn against the unconfirmed claim, the fence clear against the fenced one', async () => {
    const { calls } = serve(show({ state: 'unconfirmed', claim: null, detail: { claim_id: 41, reported_at: NOW - HOUR, runner_id: 1, hostname: 'host-one' }, fence: { claim_id: 40, runner_id: 2, hostname: 'host-two', since: NOW - HOUR } }),
      'administrator', { 'POST /v1/ui/claims/41/confirm': { ok: true }, 'POST /v1/ui/claims/40/fence-clear': { ok: true } });
    renderApp('/repositories/docs/tickets/T-1');
    await screen.findByRole('heading', { level: 1 });
    const completion = await screen.findByRole('group', { name: 'The unconfirmed completion' });
    expect(within(completion).getAllByRole('button').map((b) => b.textContent)).toEqual(['Confirm an unconfirmed completion…', 'Release an unconfirmed completion…']);
    expect(within(screen.getByRole('group', { name: 'The pending fence' })).getByRole('button', { name: 'Clear a fenced claim, releasing its seats…' })).toBeDefined();
    expect(section('Claim').textContent).toContain('fence is pending: claim 40 of host-two');
    fireEvent.click(within(completion).getByRole('button', { name: 'Confirm an unconfirmed completion…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => !/cancel/i.test(b.textContent ?? ''))!);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const sent = calls.find((c) => c.method === 'POST')!;
    expect([sent.path, sent.body]).toEqual(['/v1/ui/claims/41/confirm', { confirm: true }]);
  });

  it('the acknowledgement is one click on its finding', async () => {
    const { calls } = serve(show(), 'owner', { 'POST /v1/ui/scope/12/resolve': { ok: true } });
    renderApp('/repositories/docs/tickets/T-1');
    const scope = await screen.findByRole('table', { name: 'Open scope findings' });
    fireEvent.click(await within(scope).findByRole('button', { name: /Resolve a scope finding/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.path).toBe('/v1/ui/scope/12/resolve');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
