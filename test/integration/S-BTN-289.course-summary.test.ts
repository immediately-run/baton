// S-BTN-289 a course's summary, and what the course read refuses (B-197; BATON_SPEC §14):
//   1. `?summary=1` answers the course, its refusal, runners, legs without their runs, stations
//      and stats — no tickets, no runs, no cursor — with the same counts as the full read;
//   2. a course the repository's registry does not hold is `not-found`, as is a segment that is
//      no course id; a repository the caller cannot read is the one `forbidden`;
//   3. `?since=` over 7 days, a `summary` other than 1, a cursor on a summary, another read's or
//      a tampered cursor and an unknown parameter are `invalid-params`;
//   4. a bearer no grant binds is `forbidden`; a stranger is `unauthenticated`;
//   5. an unchanged poll is `304` by its ETag (B-205).
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { ORIGIN, runnerCall, sessionCall, withCore } from '../helpers';
import { makeKey, signedRequest } from '../lib/sshKeys';
import { courseFixture, type CourseFixture } from '../lib/courseFixture';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
type Json = Record<string, any>;

let f: CourseFixture;

async function get(path: string): Promise<{ status: number; json: Json; etag: string | null }> {
  const res = await sessionCall(f.cookie, `/v1/repositories/docs/courses/${path}`);
  return { status: res.status, json: res.status === 304 ? {} : ((await res.json()) as Json), etag: res.headers.get('ETag') };
}

beforeEach(async () => {
  f = await courseFixture(T0);
});

describe('S-BTN-289 the course summary and the course read’s refusals (B-197)', () => {
  it('?summary=1 carries no tickets and no runs, and the full read’s counts', async () => {
    const full = await get('roadmap-pr');
    const summary = await get('roadmap-pr?summary=1');
    expect(summary.status).toBe(200);
    expect(Object.keys(summary.json).sort()).toEqual(['counts', 'course', 'intake', 'legs', 'off_graph', 'refused', 'runners', 'server_time', 'stations', 'stats', 'summary', 'window']);
    expect(summary.json.summary).toBe(true);
    for (const leg of summary.json.legs as Json[]) {
      expect('runs' in leg).toBe(false);
      for (const b of leg.state.blocked as Json[]) expect(Object.keys(b).sort()).toEqual(['count', 'found', 'kind']);
    }
    const strip = (legs: Json[]) => legs.map(({ runs: _runs, state, ...l }) => ({ ...l, state: { ...state, blocked: (state.blocked as Json[]).map(({ tickets: _t, ...b }) => b) } }));
    expect(summary.json.legs).toEqual(strip(full.json.legs));
    for (const k of ['course', 'refused', 'runners', 'stations', 'stats', 'off_graph', 'counts', 'intake']) expect([k, summary.json[k]]).toEqual([k, full.json[k]]);

    // An unchanged poll costs a 304.
    expect(summary.etag).toMatch(/^"/);
    const again = await sessionCall(f.cookie, '/v1/repositories/docs/courses/roadmap-pr?summary=1', { headers: { 'If-None-Match': summary.etag! } });
    expect(again.status).toBe(304);
  });

  it('refuses an unknown course, a bad window, a foreign cursor and an unknown parameter', async () => {
    for (const id of ['nope', 'UPPER', 'a%20b']) {
      const r = await get(id);
      expect([id, r.status, r.json.code]).toEqual([id, 404, 'not-found']);
    }
    expect((await sessionCall(f.cookie, '/v1/repositories/nowhere/courses/roadmap-pr')).status).toBe(403);
    for (const q of ['since=8d', 'since=soon', 'summary=0', 'summary=yes', 'limit=5', 'summary=1&cursor=x', 'cursor=x']) {
      const r = await get(`roadmap-pr?${q}`);
      expect([q, r.status, r.json.code]).toEqual([q, 400, 'invalid-params']);
    }
    // A cursor of this read under another window is another read's.
    const page = await get('roadmap-pr');
    expect((await get(`roadmap-pr?since=2h&cursor=${encodeURIComponent(page.json.next_cursor)}`)).json.code).toBe('invalid-params');
    // …and another caller's: the owner key's page is not the session's.
    const created = Math.floor((await withCore((c) => c.now())) / 1000);
    const foreign = await hostCall(await signedRequest(f.owner, `${ORIGIN}/v1/repositories/docs/courses/roadmap-pr?cursor=${encodeURIComponent(page.json.next_cursor)}`, { created }));
    expect(foreign.status).toBe(400);

    // A seed credential's bearer holds no grant on the repository; a stranger is no one.
    expect((await runnerCall('/v1/repositories/docs/courses/roadmap-pr?summary=1')).status).toBe(403);
    const stranger = await hostCall(await signedRequest(await makeKey('ssh-ed25519', 'stranger'), `${ORIGIN}/v1/repositories/docs/courses/roadmap-pr`, { created }));
    expect(stranger.status).toBe(401);
  });
});
