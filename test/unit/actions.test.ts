// actions (B-192, B-204; BATON_SPEC §11.3 R-BTN-129): the action table's pure half — matching a
// request to its entry, which callers an entry admits, what `GET /v1/actions` answers each
// session role, and `check:actions`' rules, with the two failing fixtures B-204 names.
import { describe, expect, it } from 'vitest';
import { ACTIONS, actionsFor, admitsSession, bodyMatches, checkActions, keyReadable, listsSession, matchAction, matchActions, sessionReadable, type Action } from '../../src/core/actions';
import { SCREENS } from '../../src/core/screens';

const SCREEN_IDS = SCREENS.map((s) => s.id);
const byId = (id: string) => ACTIONS.find((a) => a.id === id)!;

describe('the action table', () => {
  it('passes check:actions against screens.ts', () => {
    const { errors, uncontrolled } = checkActions(ACTIONS, SCREEN_IDS);
    expect(errors).toEqual([]);
    // Listed, never failing: the screens no control names yet.
    expect(uncontrolled).toContain('root');
    expect(uncontrolled).not.toContain('repository/tickets/{ticket}');
  });

  it('check:actions fails a view naming no screen, and a view on an entry no session can call', () => {
    const nowhere: Action = { ...byId('ticket.hold'), id: 'fixture.nowhere', ui: { ...byId('ticket.hold').ui, view: ['repository/nowhere'] } };
    const keyed: Action = { ...byId('ticket.hold'), id: 'fixture.keyed', callers: [{ principal: 'owner', scope: 'repository' }], ui: { view: ['repository/board'] } };
    expect(checkActions([nowhere], SCREEN_IDS).errors).toEqual(['fixture.nowhere: ui.view names no screen: repository/nowhere']);
    expect(checkActions([keyed], SCREEN_IDS).errors).toEqual(['fixture.keyed: ui.view is set on an entry whose callers list no session']);
    // …and an id outside the grammar, or listed twice.
    expect(checkActions([{ ...byId('ticket.hold'), id: 'Ticket_hold' }], SCREEN_IDS).errors[0]).toMatch(/breaks the grammar/);
    expect(checkActions([byId('ticket.hold'), byId('ticket.hold')], SCREEN_IDS).errors).toEqual(['ticket.hold: the id is listed twice']);
    expect(checkActions([byId('ticket.hold')], SCREEN_IDS)).toEqual({ errors: [], uncontrolled: SCREEN_IDS.filter((s) => s !== 'repository/tickets/{ticket}') });
  });

  it('every entry a route shares is told apart by match, and no two entries are one request', () => {
    const routes = new Map<string, Action[]>();
    for (const a of ACTIONS) routes.set(`${a.http.method} ${a.http.path}`, [...(routes.get(`${a.http.method} ${a.http.path}`) ?? []), a]);
    for (const [route, entries] of routes) {
      if (entries.length > 1) expect([route, entries.every((e) => e.http.match)]).toEqual([route, true]);
    }
    // B-204 item 4's placements.
    expect(byId('ticket.hold').ui!.view).toEqual(['repository/tickets/{ticket}']);
    expect(byId('leg.stop').ui!.view).toEqual(['repository/tickets/{ticket}', 'repository/runners/{runner}']);
    expect(byId('runner.wind-down').ui!.view).toEqual(['repository/runners/{runner}']);
    expect(byId('adoption.confirm').ui!.view).toEqual(['repository/sync']);
    for (const a of ACTIONS) if (a.ui) expect([a.id, listsSession(a)]).toEqual([a.id, true]);
  });
});

describe('matching a request', () => {
  it('a path pattern takes one segment per parameter', () => {
    expect(matchAction('GET', '/v1/repositories')?.action.id).toBe('repo.list');
    expect(matchAction('GET', '/v1/repositories/docs/board')).toMatchObject({ action: { id: 'repo.board' }, params: { repository: 'docs' } });
    expect(matchAction('GET', '/v1/repositories/docs/tickets/T-1')).toMatchObject({ action: { id: 'ticket.show' }, params: { repository: 'docs', ticket: 'T-1' } });
    expect(matchAction('GET', '/v1/repositories/docs/tickets/T-1/legs/implement/runs')?.params).toEqual({ repository: 'docs', ticket: 'T-1', leg: 'implement' });
    expect(matchAction('HEAD', '/v1/repositories/docs/board')?.action.id).toBe('repo.board');
    expect(matchAction('GET', '/v1/repositories/docs/board/extra')).toBeNull();
    expect(matchAction('GET', '/v1/repositories/docs')).toBeNull();
    expect(matchAction('POST', '/v1/repositories/docs/board')).toBeNull();
    expect(matchAction('GET', '/v1/repositories/a%2Fb/board')?.params.repository).toBe('a%2Fb');
  });

  it('a route several entries share is told apart by its body; none or several is no match', () => {
    expect(matchActions('POST', '/v1/ui/messages').map((h) => h.action.id).sort()).toEqual(['leg.stop', 'runner.status-request', 'runner.wind-down']);
    expect(matchAction('POST', '/v1/ui/messages', { kind: 'release' })?.action.id).toBe('leg.stop');
    expect(matchAction('POST', '/v1/ui/messages', { kind: 'wind-down' })?.action.id).toBe('runner.wind-down');
    expect(matchAction('POST', '/v1/ui/messages', { kind: 'nope' })).toBeNull();
    expect(matchAction('POST', '/v1/ui/messages')).toBeNull();
    expect(matchAction('POST', '/v1/ui/overrides/docs:T-1', { hold: true })?.action.id).toBe('ticket.hold');
    expect(matchAction('POST', '/v1/ui/overrides/docs:T-1', { hold: false })?.action.id).toBe('ticket.unhold');
    expect(matchAction('POST', '/v1/ui/overrides/docs:T-1', { expedite: false })?.action.id).toBe('ticket.expedite');
    // A body naming both a hold and an expedite is two actions: no one entry.
    expect(matchAction('POST', '/v1/ui/overrides/docs:T-1', { hold: true, expedite: true })).toBeNull();
    expect(bodyMatches({ kind: 'release' }, null)).toBe(false);
    expect(bodyMatches(undefined, null)).toBe(true);
  });

  it('what the front asks: a session read, a key read', () => {
    for (const p of ['/v1/repositories', '/v1/actions', '/v1/repositories/docs/board', '/v1/repositories/docs/schemas', '/v1/owner/docs/grants', '/v1/owner/docs/policy/log', '/v1/ui/session',
      // B-202: the tenant reads admit an administrator's session.
      '/v1/admin/repositories', '/v1/admin/tenant']) {
      expect([p, sessionReadable(p)]).toEqual([p, true]);
    }
    for (const p of ['/v1/admin/export', '/v1/admin/state', '/v1/ui/state', '/v1/owner/docs/signing-keys', '/v1/runner/next', '/v1/sync/head', '/v1/repositories/docs/sequences/ticket/next', '/v1/ui/messages']) {
      expect([p, sessionReadable(p)]).toEqual([p, false]);
    }
    expect(keyReadable('/v1/repositories/docs/courses')).toBe(true);
    expect(keyReadable('/v1/actions')).toBe(false);
  });
});

describe('what a session may call', () => {
  it('an administrator’s session: every entry listing its role; an owner’s: its own, never an administrator’s', () => {
    const admin = actionsFor('administrator').map((a) => a.id);
    const owner = actionsFor('owner', { ownsRepository: true }).map((a) => a.id);
    expect(admin).toContain('ticket.hold');
    expect(admin).toContain('claim.force-reap');
    expect(owner).toContain('ticket.hold');
    expect(owner).not.toContain('claim.force-reap');
    expect(owner).not.toContain('repo.cutover');
    expect(owner).not.toContain('ui.state');
    expect(owner.every((id) => admin.includes(id))).toBe(true);
    expect(admitsSession(byId('claim.force-reap'), 'owner')).toBe(false);
    expect(admitsSession(byId('claim.force-reap'), 'administrator')).toBe(true);
    // An owner's session whose key owns no repository any more sees no repository-scoped entry.
    const none = actionsFor('owner', { ownsRepository: false });
    expect(none.map((a) => a.id)).toContain('repo.list');
    expect(none.some((a) => a.callers[0].scope === 'repository')).toBe(false);
    // The answer carries the matching caller alone, and never `delegated`.
    const marked: Action = { ...byId('repo.board'), delegated: true };
    expect(actionsFor('owner', { ownsRepository: true }, [marked])).toEqual([{ ...byId('repo.board'), callers: [{ principal: 'session', roles: ['administrator', 'owner'], scope: 'repository' }] }]);
  });
});
