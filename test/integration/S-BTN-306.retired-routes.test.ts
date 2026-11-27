// S-BTN-306 what the cutover retired, and what it kept (BATON_SPEC §11.3 R-BTN-129, §11.4
// R-BTN-155, §14; B-203): V1's two routes are gone and the session's write surface stands.
// Must hold:
//   1. `GET /v1/ui/state` and `POST /v1/ui/claims/{claim}/resolve` are `not-found` — no route —
//      to an administrator's session, and no registry entry names either; the completion's own
//      routes (`…/confirm`, `…/release`, S-BTN-262) answer for themselves;
//   2. every `/v1/ui` write V2 calls is still a registry entry a session may call, and the
//      session's own read (`GET /v1/ui/session`) still answers;
//   3. `GET /v1/admin/repositories` and `GET /v1/admin/capacities` are the reads dispatcher's
//      for every caller — an administrator's key gets the read's own fields, an owner's key
//      the dispatcher's refusal — so the administrator route's older `GET` branches for them,
//      which nothing could reach, are removed with nothing lost; the writes on the same paths
//      keep their route.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS, listsSession } from '../../src/core/actions';
import { fixture, postSession, readAs, readSession, type Fixture } from '../lib/needsYouFixture';
import { keyCall } from '../helpers';

let f: Fixture;

beforeEach(async () => {
  f = await fixture();
});

describe('S-BTN-306 the cutover’s retired routes (B-203)', () => {
  it('V1’s state read and its one completion route are no route; the completion’s own routes answer', async () => {
    const state = await readSession(f.cookie, '/v1/ui/state');
    expect([state.status, state.json.code, state.json.message]).toEqual([404, 'not-found', 'no route GET /v1/ui/state']);
    for (const body of [{ action: 'confirm', confirm: true }, { action: 'release', confirm: true }]) {
      const gone = await postSession(f.cookie, '/v1/ui/claims/1/resolve', body);
      expect([gone.status, gone.json.code, gone.json.message]).toEqual([404, 'not-found', 'no route POST /v1/ui/claims/1/resolve']);
    }
    // The routes that replaced it are routes: their `not-found` is the claim's, not the path's.
    for (const verb of ['confirm', 'release']) {
      const res = await postSession(f.cookie, `/v1/ui/claims/1/${verb}`, { confirm: true });
      expect([verb, res.status, res.json.message]).toEqual([verb, 404, 'no unconfirmed completion with that id']);
    }
    expect(ACTIONS.filter((a) => a.http.path === '/v1/ui/state' || /\/resolve$/.test(a.http.path) && a.http.path.includes('/claims/'))).toEqual([]);
  });

  it('the session’s write surface stands, each a registry entry a session may call', async () => {
    const kept = ['/v1/ui/messages', '/v1/ui/overrides/{ticket}', '/v1/ui/resync', '/v1/ui/board/accept', '/v1/ui/scope/{finding}/resolve', '/v1/ui/claims/{claim}/reap',
      '/v1/ui/claims/{claim}/fence-clear', '/v1/ui/claims/{claim}/confirm', '/v1/ui/claims/{claim}/release', '/v1/ui/cutover', '/v1/ui/adoptions/{ticket}/confirm', '/v1/ui/logout'];
    const posts = ACTIONS.filter((a) => a.http.method === 'POST' && (a.ui?.route ?? a.http).path.startsWith('/v1/ui/'));
    expect([...new Set(posts.map((a) => (a.ui?.route ?? a.http).path))].sort()).toEqual([...kept].sort());
    for (const a of posts) expect([a.id, listsSession(a)]).toEqual([a.id, true]);
    expect((await readSession(f.cookie, '/v1/ui/session')).json).toEqual({ ok: true });
  });

  it('the registry and the capacities are the reads’ for every caller; their writes keep the administrator’s route', async () => {
    const registry = await readAs(f.admin, '/v1/admin/repositories');
    // `sync_keys` is the read's own (B-202): the older branch never served them.
    expect([registry.status, registry.json.repositories.every((r: Record<string, unknown>) => Array.isArray(r.sync_keys))]).toEqual([200, true]);
    expect((await keyCall(f.admin, '/v1/admin/capacities', { capability: 'key:anthropic', capacity: 2 }, 'PUT')).status).toBe(200);
    const capacities = await readAs(f.admin, '/v1/admin/capacities');
    expect([capacities.status, capacities.json.capacities.map((c: Record<string, unknown>) => [c.capability, c.held, c.holders])]).toEqual([200, [['key:anthropic', 0, []]]]);
    expect((await readAs(f.admin, '/v1/admin/capacities?capability=key:anthropic')).json.capacities.length).toBe(1);
    // An owner's key is refused by the one authorization, in its words — never the route's.
    for (const [path, id] of [['/v1/admin/repositories', 'admin.repo.list'], ['/v1/admin/capacities', 'admin.capacity.list']]) {
      const refused = await readAs(f.owner, path);
      expect([path, refused.status, refused.json.code, refused.json.message]).toEqual([path, 403, 'forbidden', `${id} is not this caller's to call`]);
      expect([path, (await readSession(f.cookie, path)).status]).toEqual([path, 200]);
    }
    // The writes on the same paths are the administrator's route's still.
    expect((await keyCall(f.owner, '/v1/admin/repositories', { id: 'docs', weight: 2 })).json).toMatchObject({ code: 'forbidden', message: expect.stringContaining('R-BTN-57') });
    expect((await keyCall(f.admin, '/v1/admin/repositories', { id: 'docs', weight: 2 })).status).toBe(200);
  });
});
