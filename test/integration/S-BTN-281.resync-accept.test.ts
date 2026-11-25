// S-BTN-281 a session's resync and accept (B-201; BATON_SPEC §4.3 R-BTN-11, §3.3 R-BTN-73,
// R-BTN-94, §11.4 R-BTN-155, §12.4 R-BTN-16): `POST /v1/ui/resync` (`repo.resync`) and
// `POST /v1/ui/board/accept` (`repo.accept-post`). Must hold:
//   1. an administrator's session's resync dispatches the repository's sync workflow once,
//      logs it (an `admin` event, `act: resync`) with who asked, answers `{ok: true}`, and moves nothing of the
//      board; the sync read then shows when it was asked;
//   2. a second within the dispatch window is `conflict` and sends nothing; after it, one is
//      sent again;
//   3. `force` or `sha` is `invalid-params` — a forced resync is not built — and nothing is
//      sent; an unknown field, a missing repository and a repository that does not exist are
//      refused;
//   4. without a session it is `unauthenticated`; a request from another origin is `forbidden`
//      (R-BTN-16); a key is not a caller;
//   5. both actions are the Sync screen's controls in the registry, an administrator's
//      session's; accept takes the held post, which the sync's next post then makes the head.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS } from '../../src/core/actions';
import { call, captureDispatches, keyCall, rows, setClock } from '../helpers';
import { fixture, MIN, postSession, readSession, T0, type Fixture, type Json } from '../lib/needsYouFixture';

let f: Fixture;
let sent: string[];
const events = () => rows<{ kind: string; actor: string; repository_id: string }>(`SELECT kind, actor, repository_id FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'resync' ORDER BY seq`);
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  f = await fixture();
  sent = await captureDispatches();
});

describe('S-BTN-281 a session’s resync and accept (B-201)', () => {
  it('a resync dispatches the sync once, is logged, and moves nothing of the board', async () => {
    const head = (await readSession(f.cookie, '/v1/repositories/ops/sync')).json.head;
    const res = await postSession(f.cookie, '/v1/ui/resync', { repository: 'ops' });
    expect([res.status, res.json]).toEqual([200, { ok: true }]);
    await settle();
    expect(sent).toEqual(['ops:sync']);
    expect(await events()).toEqual([{ kind: 'admin', actor: `owner:${f.admin.fingerprint}`, repository_id: 'ops' }]);
    const after = (await readSession(f.cookie, '/v1/repositories/ops/sync')).json;
    expect([after.head, after.dispatch.last_resync_request_at]).toEqual([head, T0]);
    // Within the window: refused, and nothing more is sent. Another repository has its own window.
    await setClock(T0 + 29_000);
    const again = await postSession(f.cookie, '/v1/ui/resync', { repository: 'ops' });
    expect([again.status, again.json.code]).toEqual([409, 'conflict']);
    expect((await postSession(f.cookie, '/v1/ui/resync', { repository: 'docs' })).status).toBe(200);
    await setClock(T0 + 30_000);
    expect((await postSession(f.cookie, '/v1/ui/resync', { repository: 'ops' })).status).toBe(200);
    await settle();
    expect(sent).toEqual(['ops:sync', 'docs:sync', 'ops:sync']);
  });

  it('a forced resync is not built: force and sha are refused by name, and nothing is sent', async () => {
    const bodies: [unknown, string][] = [
      [{ repository: 'ops', force: true, sha: 'a'.repeat(40) }, 'invalid-params'],
      [{ repository: 'ops', force: false }, 'invalid-params'],
      [{ repository: 'ops', sha: 'a'.repeat(40) }, 'invalid-params'],
      [{ repository: 'ops', confirm: true }, 'invalid-params'],
      [{}, 'invalid-params'],
      [{ repository: 'no/such' }, 'invalid-params'],
      [{ repository: 'nowhere' }, 'forbidden'],
    ];
    for (const [body, code] of bodies) {
      const res = await postSession(f.cookie, '/v1/ui/resync', body);
      expect([JSON.stringify(body), res.json.code]).toEqual([JSON.stringify(body), code]);
    }
    const forced = await postSession(f.cookie, '/v1/ui/resync', { repository: 'ops', force: true, sha: 'a'.repeat(40) });
    expect(forced.json.message).toMatch(/not built/);
    await settle();
    expect(sent).toEqual([]);
    expect(await events()).toEqual([]);
  });

  it('it is a session’s alone, from the dashboard’s own origin', async () => {
    const body = JSON.stringify({ repository: 'ops' });
    const json = { 'Content-Type': 'application/json' };
    expect((await call('/v1/ui/resync', { method: 'POST', headers: json, body })).status).toBe(401);
    const elsewhere = await call('/v1/ui/resync', { method: 'POST', headers: { ...json, Cookie: f.cookie, Origin: 'https://elsewhere.example' }, body });
    expect(elsewhere.status).toBe(403);
    // A signed key is no caller of a `/v1/ui/*` route.
    expect([401, 403, 404]).toContain((await keyCall(f.admin, '/v1/ui/resync', { repository: 'ops' })).status);
    await settle();
    expect(sent).toEqual([]);
  });

  it('resync and accept are the Sync screen’s controls; accept takes the held post', async () => {
    const by = new Map(ACTIONS.map((a) => [a.id, a]));
    for (const id of ['repo.resync', 'repo.accept-post']) {
      expect([id, by.get(id)!.ui?.view, by.get(id)!.effect, by.get(id)!.callers]).toEqual([id, ['repository/sync'], 'write', [{ principal: 'session', roles: ['administrator'], scope: 'instance' }]]);
    }
    const listed = ((await readSession(f.cookie, '/v1/actions')).json.actions as Json[]).filter((a) => a.ui?.view?.includes('repository/sync')).map((a) => a.id).sort();
    expect(listed).toEqual(['adoption.confirm', 'repo.accept-post', 'repo.cutover', 'repo.resync']);
    // A rewritten history is held; the session accepts it; the sync's next force post is the head.
    await setClock(T0 + MIN);
    expect(((await f.git.post({ force: true })) as Json).code).toBe('snapshot-rejected');
    const held = (await readSession(f.cookie, '/v1/repositories/docs/sync')).json.held as Json[];
    expect(held.map((h) => h.accepted_at)).toEqual([null]);
    expect((await postSession(f.cookie, '/v1/ui/board/accept', { repository: 'docs', sha: 'f'.repeat(40) })).json.code).toBe('not-found');
    const accepted = await postSession(f.cookie, '/v1/ui/board/accept', { repository: 'docs', sha: held[0].sha });
    expect([accepted.status, accepted.json]).toEqual([200, { ok: true }]);
    const after = (await readSession(f.cookie, '/v1/repositories/docs/sync')).json;
    expect(after.held.map((h: Json) => h.accepted_at)).toEqual([T0 + MIN]);
    expect(after.allowed).toEqual(['repo.resync']);
  });
});
