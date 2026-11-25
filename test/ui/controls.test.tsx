// controls.test.tsx — B-207: a screen's controls are the session's registry entries (`GET
// /v1/actions`) whose `ui.view` names the screen, and nothing else. The schema table maps each
// keyword and refuses what it cannot draw; controls draw by `ui.view` and by the read's
// `allowed` word; the generated form validates required fields; a destructive entry's dialog
// sends `confirm: true`; Stop opens the same dialog; a `202` opens the
// code dialog with the role's line and closes when a read changes; a refusal is drawn as text;
// and B-191's scenario, DOM half: an owner's entries draw hold, cancel and stop, an
// administrator's force-reap too, and a hostile summary is text. The real registry's entries
// (`src/core/actions.ts`) are drawn as they stand.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ACTIONS, actionsFor } from '../../src/core/actions';
import { Controls, CODE_MS } from '../../src/dashboard/app/controls/Controls';
import { controlsOf, labelOf } from '../../src/dashboard/app/controls/useControls';
import { useRead } from '../../src/dashboard/lib/reads';
import { bodyOf, formOf, readForm, routeOf } from '../../src/dashboard/lib/schemaForm';
import type { Action } from '../../src/dashboard/lib/types';
import { mockFetch, refuse, renderWithShell, repoList, repoRow, resetShell, type Route } from './helpers';

const TICKET = 'repository/tickets/{ticket}';
const SESSION: Action['callers'] = [{ principal: 'session', scope: 'instance', roles: ['administrator', 'owner'] }];
const TARGET = { repository: 'docs', ticket: 'docs:R3-1', ticket_id: 'docs:R3-1', to_runner_id: 4, claim: 9, reason: 'requested' };

const entry = (id: string, over: Partial<Action> = {}): Action => ({
  id, summary: `${id}: a fixture.`, effect: 'write', http: { method: 'POST', path: `/v1/ui/fixture/${id}` }, callers: SESSION,
  input: { type: 'object', properties: {} }, ui: { view: [TICKET] }, ...over,
});

afterEach(() => {
  cleanup();
  resetShell();
});

describe('the schema table (B-207 item 2)', () => {
  const form = (properties: Action['input']['properties'], required: string[] = [], context = {}, match?: Action['http']['match']) =>
    formOf({ input: { type: 'object', properties, required }, http: { method: 'POST', path: '/x', ...(match ? { match } : {}) } }, context);

  it('maps each keyword to its field', () => {
    const f = form({
      tier: { type: 'string', enum: ['a', 'b'] },
      restart: { type: 'string', enum: ['now', 'later'] },
      option: { type: 'string', enum: ['x', 'y'] },
      on: { type: 'boolean' },
      n: { type: 'integer' },
      ratio: { type: 'number' },
      note: { type: 'string', pattern: '^[a-z]+$', maxLength: 40 } as never,
      tags: { type: 'array', items: { type: 'string' } },
    }, ['note']);
    if (!f.drawable) throw new Error('drawable');
    expect(f.fields.map((x) => [x.name, x.kind])).toEqual([['tier', 'select'], ['restart', 'radio'], ['option', 'radio'], ['on', 'checkbox'], ['n', 'number'], ['ratio', 'number'], ['note', 'text'], ['tags', 'list']]);
    expect(f.fields.find((x) => x.name === 'note')).toMatchObject({ required: true, pattern: '^[a-z]+$', maxLength: 40 });
    expect(f.fields.find((x) => x.name === 'n')?.integer).toBe(true);
  });

  it('never draws confirm, a const, a matched field or one the context fills', () => {
    const f = form({
      confirm: { type: 'boolean', const: true },
      kind: { type: 'string', const: 'release' },
      hold: { type: 'boolean' },
      to_runner_id: { type: 'integer' },
      payload: { type: 'object', required: ['ticket_id', 'reason'], properties: { ticket_id: { type: 'string' }, reason: { type: 'string', enum: ['requested', 'other'] } } },
    }, ['to_runner_id'], { to_runner_id: '4', ticket_id: 'docs:R3-1' }, { hold: true });
    if (!f.drawable) throw new Error('drawable');
    expect(f.preset).toEqual({ kind: 'release', hold: true, to_runner_id: 4, 'payload.ticket_id': 'docs:R3-1' });
    expect(f.fields.map((x) => [x.path, x.kind, x.required])).toEqual([['payload.reason', 'select', true]]);
    expect(bodyOf(f.preset, { 'payload.reason': 'requested' })).toEqual({ kind: 'release', hold: true, to_runner_id: 4, payload: { ticket_id: 'docs:R3-1', reason: 'requested' } });
  });

  it('refuses a property it cannot draw', () => {
    expect(form({ rows: { type: 'array', items: { type: 'object' } } })).toEqual({ drawable: false, why: 'rows' });
    expect(form({ blob: { type: 'object' } })).toEqual({ drawable: false, why: 'blob' });
  });

  it('reads the form: required, numbers, lists', () => {
    const f = form({ note: { type: 'string' }, n: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } }, on: { type: 'boolean' } }, ['note', 'n']);
    if (!f.drawable) throw new Error('drawable');
    expect(readForm(f.fields, { note: ' ', n: '1.5', tags: '', on: false })).toEqual({ values: { on: false }, faults: { note: 'required', n: 'must be a whole number' } });
    expect(readForm(f.fields, { note: 'x', n: '3', tags: 'a, b,,c', on: true })).toEqual({ values: { note: 'x', n: 3, tags: ['a', 'b', 'c'], on: true }, faults: {} });
  });

  it('fills a route’s parameters from the context, encoded; null while one is missing', () => {
    expect(routeOf('/v1/ui/overrides/{ticket}', { ticket: 'docs:R3 1' })).toBe('/v1/ui/overrides/docs%3AR3%201');
    expect(routeOf('/v1/ui/claims/{claim}/reap', { claim_id: 9 })).toBe('/v1/ui/claims/9/reap');
    expect(routeOf('/v1/ui/claims/{claim}/reap', {})).toBeNull();
  });
});

describe('controls from the registry (B-207 items 1, 3)', () => {
  it('draws only the entries whose ui.view names the screen, the destructive ones last, labelled by summary', () => {
    const actions = [
      entry('a.destroy', { summary: 'Destroy the thing: gone for good.', effect: 'destructive', input: { type: 'object', properties: { confirm: { type: 'boolean', const: true } } } }),
      entry('a.write', { summary: 'Hold a ticket: nothing claims it.' }),
      entry('a.elsewhere', { ui: { view: ['repository/sync'] } }),
      entry('a.nowhere', { ui: undefined }),
      entry('a.read', { effect: 'read' }),
      entry('a.claim', { http: { method: 'POST', path: '/v1/ui/claims/{claim}/reap' } }),
    ];
    const got = controlsOf(actions, TICKET, { ticket: 'docs:R3-1' });
    expect(got.map((c) => [c.entry.id, c.label, c.dialog])).toEqual([['a.write', 'Hold a ticket', false], ['a.destroy', 'Destroy the thing…', true]]);
    expect(labelOf('Stop: ask the runner to release.', false)).toBe('Stop');
    // With the claim known, its control is drawn; a ui route is preferred to http.
    expect(controlsOf(actions, TICKET, { claim: 9 }).map((c) => c.path)).toContain('/v1/ui/claims/9/reap');
    expect(controlsOf([entry('a.ui', { ui: { view: [TICKET], route: { method: 'POST', path: '/v1/ui/own/{ticket}' } } })], TICKET, { ticket: 't' })[0].path).toBe('/v1/ui/own/t');
  });

  it('a click sends same-origin JSON to the entry’s route and refetches the screen’s reads on 200', async () => {
    let n = 0;
    const { calls } = mockFetch({
      '/v1/repositories/docs/tickets/R3-1': () => ({ body: { held: ++n > 1 } }),
      'POST /v1/ui/overrides/docs%3AR3-1': { ok: true },
    });
    function Stub() {
      const read = useRead<{ held: boolean }>('/v1/repositories/docs/tickets/R3-1');
      return <><p>held: {String(read.data?.held)}</p><Controls view={TICKET} target={TARGET} /></>;
    }
    renderWithShell(<Stub />, { actions: actionsFor('owner', { ownsRepository: true }).filter((a) => a.id === 'ticket.hold') as Action[] });
    await screen.findByText('held: false');
    fireEvent.click(screen.getByRole('button', { name: 'Hold a ticket' }));
    await screen.findByText('held: true');
    const post = calls.find((c) => c.method === 'POST')!;
    expect([post.path, post.body, post.headers['content-type']]).toEqual(['/v1/ui/overrides/docs%3AR3-1', { hold: true }, 'application/json']);
  });

  it('validates a required field before it sends, and sends the form’s values with the context', async () => {
    const { calls } = mockFetch({ 'POST /v1/ui/fixture/a.note': { ok: true } });
    const actions = [entry('a.note', { summary: 'Add a note.', input: { type: 'object', required: ['note', 'repository'], properties: { note: { type: 'string' }, repository: { type: 'string' } } } })];
    renderWithShell(<Controls view={TICKET} target={TARGET} />, { actions });
    const input = screen.getByLabelText('note *');
    fireEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    expect((await screen.findByRole('alert')).textContent).toBe('required');
    expect(calls).toHaveLength(0);
    expect(screen.queryByLabelText(/repository/)).toBeNull(); // the context fills it
    fireEvent.change(input, { target: { value: 'looked at' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    expect(calls[0].body).toEqual({ note: 'looked at', repository: 'docs' });
  });

  it('a form of several fields opens as a popover', async () => {
    const { calls } = mockFetch({ 'POST /v1/ui/fixture/a.two': { ok: true } });
    const actions = [entry('a.two', { summary: 'Set two.', input: { type: 'object', required: ['a'], properties: { a: { type: 'string', enum: ['x', 'y'] }, b: { type: 'boolean' } } } })];
    renderWithShell(<Controls view={TICKET} target={{}} />, { actions });
    expect(screen.queryByLabelText('a *')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set two' }));
    fireEvent.change(screen.getByLabelText('a *'), { target: { value: 'y' } });
    fireEvent.click(screen.getByLabelText('b'));
    fireEvent.click(screen.getByRole('button', { name: 'Set two' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ a: 'y', b: true });
  });

  it('names an entry whose form it cannot draw as text, not a button', () => {
    renderWithShell(<Controls view={TICKET} target={{}} />, { actions: [entry('a.blob', { input: { type: 'object', properties: { blob: { type: 'object' } } } })] });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('a.blob')).toBeDefined();
  });

  it('draws a refusal beside its control as code and message, as text, until the next change', async () => {
    mockFetch({ 'POST /v1/ui/fixture/a.note': () => refuse('conflict', '<b>already</b> held') });
    const actions = [entry('a.note', { summary: 'Add a note.', input: { type: 'object', properties: { note: { type: 'string' } } } })];
    const { container } = renderWithShell(<Controls view={TICKET} target={{}} />, { actions });
    fireEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    expect((await screen.findByRole('alert')).textContent).toBe('conflict — <b>already</b> held');
    expect(container.querySelector('b')).toBeNull();
    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'x' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the confirm dialog (B-207 item 4)', () => {
  const reap = ACTIONS.filter((a) => a.id === 'claim.force-reap');

  it('a destructive entry opens a dialog naming the action and target; confirming sends confirm: true', async () => {
    const { calls } = mockFetch({ 'POST /v1/ui/claims/9/reap': { ok: true } });
    renderWithShell(<Controls view={TICKET} target={TARGET} />, { actions: reap });
    fireEvent.click(screen.getByRole('button', { name: 'Force-reap a live claim…' }));
    const dialog = screen.getByRole('dialog', { name: 'Force-reap a live claim?' });
    expect(calls).toHaveLength(0); // nothing is sent before the dialog's own button
    expect(within(dialog).getAllByText('docs:R3-1', { selector: 'dd' }).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('9')).toBeDefined();
    expect(document.activeElement?.textContent).toBe('Cancel');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Force-reap a live claim' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([['POST', '/v1/ui/claims/9/reap', { confirm: true }]]);
  });

  it('Cancel and Escape send nothing', () => {
    const { calls } = mockFetch({});
    renderWithShell(<Controls view={TICKET} target={TARGET} />, { actions: reap });
    fireEvent.click(screen.getByRole('button', { name: 'Force-reap a live claim…' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Force-reap a live claim…' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('Stop sends nothing before confirmation', async () => {
    const { calls } = mockFetch({ 'POST /v1/ui/messages': { id: 1 } });
    renderWithShell(<Controls view={TICKET} target={TARGET} />, { actions: ACTIONS.filter((a) => a.id === 'leg.stop') });
    fireEvent.click(screen.getByRole('button', { name: 'Stop…' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ to_runner_id: 4, kind: 'release', confirm: true, payload: { ticket_id: 'docs:R3-1', reason: 'requested' } });
  });
});

describe('the code dialog (B-207 item 5)', () => {
  const actions = [entry('a.confirmed', { summary: 'Change who may write: a confirmed action.' })];
  const routes = (data: { v: number }): Record<string, Route> => ({
    '/v1/repositories/docs/policy': () => ({ body: { v: data.v }, etag: `"${data.v}"` }),
    'POST /v1/ui/fixture/a.confirmed': () => ({ status: 202, body: { confirm_code: 'K7M2Q9XA' } }),
  });
  function Stub() {
    const read = useRead<{ v: number }>('/v1/repositories/docs/policy');
    return <><p>v{read.data?.v}</p><Controls view={TICKET} target={{ repository: 'docs' }} /></>;
  }

  it('a 202 shows the code, the action and the role’s one line, and closes when a read changes', async () => {
    const data = { v: 1 };
    mockFetch(routes(data));
    const { store } = renderWithShell(<Stub />, { actions, repos: repoList([repoRow('docs')], 'administrator') });
    await screen.findByText('v1');
    fireEvent.click(screen.getByRole('button', { name: 'Change who may write' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm with your key' });
    expect(within(dialog).getByLabelText('Confirmation code').textContent).toBe('K7M2Q9XA');
    expect(within(dialog).getByText('baton admin confirm K7M2Q9XA')).toBeDefined();
    expect(within(dialog).getByText(/This page cannot confirm it/)).toBeDefined();
    // The dialog can render before its effect arms the fast poll (the 202 resolves outside act).
    await waitFor(() => expect(store.freshness().interval).toBe(5000)); // B-191's one exception to the 10-second rule
    // An unchanged poll leaves it open; the effect showing closes it.
    await act(() => store.refresh());
    expect(screen.queryByRole('dialog')).not.toBeNull();
    data.v = 2;
    await act(() => store.refresh());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('v2')).toBeDefined();
    expect(store.freshness().interval).toBe(10_000);
  });

  it('names the owner’s line for an owner’s session', async () => {
    mockFetch(routes({ v: 1 }));
    renderWithShell(<Stub />, { actions, repos: repoList([repoRow('docs')], 'owner') });
    fireEvent.click(await screen.findByRole('button', { name: 'Change who may write' }));
    expect(await screen.findByText('baton owner confirm K7M2Q9XA')).toBeDefined();
  });

  it('says the code expired after its two minutes', async () => {
    vi.useFakeTimers();
    try {
      mockFetch(routes({ v: 1 }));
      renderWithShell(<Stub />, { actions, repos: repoList([repoRow('docs')], 'administrator') });
      await act(() => vi.advanceTimersByTimeAsync(0));
      fireEvent.click(screen.getByRole('button', { name: 'Change who may write' }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      const dialog = screen.getByRole('dialog', { name: 'Confirm with your key' });
      expect(CODE_MS).toBe(120_000);
      await act(() => vi.advanceTimersByTimeAsync(CODE_MS - 1));
      expect(within(dialog).queryByText(/Timed out/)).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(within(dialog).getByRole('alert').textContent).toBe('Timed out: the code expired. Nothing was done.');
      expect(within(dialog).queryByText(/baton admin confirm/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('B-191’s scenario, the DOM half (B-207 item 6)', () => {
  const names = () => screen.getAllByRole('button').map((b) => b.textContent);

  it('an owner’s entries draw hold, expedite and stop; an administrator’s force-reap too', () => {
    mockFetch({});
    const owner = renderWithShell(<Controls view={TICKET} target={TARGET} />, { actions: actionsFor('owner', { ownsRepository: true }) as Action[] });
    expect(names()).toEqual(expect.arrayContaining(['Hold a ticket', 'Lift a ticket’s hold', 'Stop…']));
    expect(names()).not.toContain('Force-reap a live claim…');
    owner.unmount();
    renderWithShell(<Controls view={TICKET} target={TARGET} />, { actions: actionsFor('administrator', { ownsRepository: true }) as Action[] });
    expect(names()).toEqual(expect.arrayContaining(['Hold a ticket', 'Stop…', 'Force-reap a live claim…']));
    // The destructive ones, each with a dialog, come last (B-222 placed the fence clear and the
    // completion's confirm and release on this screen too; the ticket's page draws those
    // against their own claims).
    expect(names().indexOf('Force-reap a live claim…')).toBeGreaterThan(names().indexOf('Hold a ticket'));
    expect(names().slice(names().indexOf('Stop…')).every((n) => n!.endsWith('…'))).toBe(true);
  });

  it('an allowed list without ticket.unhold hides unhold, and draws only what it names', () => {
    mockFetch({});
    const actions = actionsFor('owner', { ownsRepository: true }) as Action[];
    renderWithShell(<Controls view={TICKET} target={TARGET} allowed={['ticket.hold', 'leg.stop']} />, { actions });
    expect(names()).toEqual(['Hold a ticket', 'Stop…']);
  });

  it('draws nothing where the session has no entry for the screen', () => {
    const { container } = renderWithShell(<Controls view="repository/goals" target={TARGET} />, { actions: actionsFor('administrator', { ownsRepository: true }) as Action[] });
    expect(container.textContent).toBe('');
  });

  it('a hostile summary is text', () => {
    const { container } = renderWithShell(<Controls view={TICKET} target={{}} />, { actions: [entry('a.x', { summary: '<img src=x onerror=alert(1)>' })] });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
