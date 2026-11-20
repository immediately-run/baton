// S-BTN-278 a dashboard session writes no attestation (B-195, B-213; BATON_SPEC §6.4 R-BTN-116,
// §11.4 R-BTN-155, §12.8 R-BTN-181, R-BTN-185; R-BTN-57): the only session that exists is an
// administrator's, and an administrator is never an owner. Must hold:
//   1. `POST /v1/repositories/{repository}/attestations` under the session cookie — with the
//      dashboard's own origin and fetch metadata — is refused `unauthenticated`: the cookie is
//      no principal on that route, and the person leg does not move;
//   2. the administrator's key is `forbidden` there, as before;
//   3. the registry lists no entry by which a session could write one, and `GET /v1/actions`
//      offers the session none;
//   4. an owner key's answer still arrives (the route's key path is unchanged), and the reads
//      then show the leg answered.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS, matchActions } from '../../src/core/actions';
import { keyCall, rows } from '../helpers';
import { atDecide, fixture, postSession, readSession, type Fixture, type Json } from '../lib/needsYouFixture';

let f: Fixture;
const ANSWER = { type: 'std:decision@1', subject: { ticket: 'P' }, value: { option: 'ship' } };
const station = () => rows<{ station: string }>('SELECT station FROM ticket_stations WHERE ticket_id = ?', 'docs:P');

beforeEach(async () => {
  f = await fixture();
  atDecide(f.git, 'P');
  expect((await f.git.post()).status).toBe(200);
});

describe('S-BTN-278 a dashboard session writes no attestation (B-195, B-213)', () => {
  it('the administrator’s session and the administrator’s key are refused; the leg stays queued', async () => {
    const session = await postSession(f.cookie, '/v1/repositories/docs/attestations', ANSWER);
    expect([session.status, session.json.code]).toEqual([401, 'unauthenticated']);
    const key = await keyCall(f.admin, '/v1/repositories/docs/attestations', ANSWER);
    expect([key.status, key.json.code]).toEqual([403, 'forbidden']);
    expect(await station()).toEqual([{ station: 'reviewed' }]);
    expect(await rows(`SELECT 1 FROM events WHERE kind = 'question-answered'`)).toEqual([]);
  });

  it('no registry entry lets a session write one, and the session is offered none', async () => {
    const posts = matchActions('POST', '/v1/repositories/docs/attestations');
    expect(posts).toEqual([]);
    expect(ACTIONS.filter((a) => a.id.startsWith('attestation.') && a.effect !== 'read')).toEqual([]);
    const listed = await readSession(f.cookie, '/v1/actions');
    expect((listed.json.actions as Json[]).filter((a) => a.http.path.includes('attestations') && a.http.method !== 'GET')).toEqual([]);
  });

  it('an owner key’s answer still arrives, and the reads show it', async () => {
    const res = await keyCall(f.owner, '/v1/repositories/docs/attestations', ANSWER);
    expect([res.status, res.json.reached]).toEqual([200, 'adjudicated']);
    expect(await station()).toEqual([{ station: 'adjudicated' }]);
    expect((await readSession(f.cookie, '/v1/repositories/docs/needs-you')).json.questions).toEqual([]);
  });
});
