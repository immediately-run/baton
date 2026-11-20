// S-BTN-287 one runner (B-196; BATON_SPEC §8.1, §9.9, §14): `GET
// /v1/repositories/{repository}/runners/{runner}` (`runner.show`) is the list's row plus the
// runner's profile, the earlier attempts on its live ticket's leg, and a window of its claims
// on the repository with their runs and nested activities. Must hold:
//   1. `runner` is the list's row with `profile`, the opaque blob as its heartbeat gave it;
//   2. `attempts` lists the earlier runs of the live ticket's running leg — run, claim, start,
//      end, end reason — and never the running one;
//   3. `window.claims` holds the claims live at any instant since `since`, each with how it
//      ended (`running`, `released`, …), its runs and its activities with `parent_id`; a claim
//      that ended before `since` is left out, and one on another repository is never listed;
//   4. `?since=` takes an ISO time or a span (`24h`, `7d`); more than 7 days back, a future
//      time and a word are `invalid-params`, as is an unknown parameter;
//   5. a runner with no grant on the repository is `not-found`, the same as none and as a
//      segment that is no runner id; a key granted elsewhere is refused before either.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { sessionCall, setClock } from '../helpers';
import { claimAndStart, claimElsewhere, fleet, grantedRunner, heartbeat, signed, type Fleet, type Granted, type Json } from '../lib/runnerFleet';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const H = 3_600_000;
const PROFILE = { cli: { version: '1.2.3' }, note: '<b>mine</b>' };

let f: Fleet;
let a: Granted;
let elsewhere: Granted;

async function show(path: string) {
  const res = await sessionCall(f.cookie, `/v1/repositories/docs/runners/${path}`);
  return { status: res.status, json: (await res.json()) as Json };
}

beforeEach(async () => {
  f = await fleet(T0);
  a = await grantedRunner('runner-a', 'host-a', [{ repository: 'docs', owner: f.docsOwner }], { profile: PROFILE });
  elsewhere = await grantedRunner('runner-c', 'host-c', [{ repository: 'ops', owner: f.opsOwner }], { courses: [{ repository: 'ops', course: 'roadmap-pr', version: 3 }] });
});

describe('S-BTN-287 one runner with its window (B-196)', () => {
  it('the row with its profile, the earlier attempts and the window’s claims with nested activities', async () => {
    // A first claim on T-1 that runs the leg and is released; an older one on T-3, long ended.
    const first = await claimAndStart(a, 'docs:T-1', 'implement');
    expect((await signed(a.key, `/v1/runner/claims/${first.claim_id}/end`, { end_reason: 'released:requested', reached: 'filed' }, a.secret)).status).toBe(200);
    expect((await f.git.refresh()).status).toBe(200);
    await setClock(T0 + 10 * 60_000);
    expect((await heartbeat(a.key, a.hostname, a.secret, { profile: PROFILE })).status).toBe(200);
    const second = await claimAndStart(a, 'docs:T-1', 'implement');
    const posted = await signed(a.key, '/v1/runner/activities', { activities: [
      { id: 'round', claim_id: second.claim_id, kind: 'review-round', seq: 1, source: 'skill', started_at: T0 + 11 * 60_000 },
      { id: 'reviewer', claim_id: second.claim_id, parent_id: 'round', kind: 'reviewer', source: 'skill', label: 'review-pr (v4)', started_at: T0 + 12 * 60_000, ended_at: T0 + 13 * 60_000, outcome: 'failed', detail: { findings: 2 } },
    ] }, a.secret);
    expect([posted.status, JSON.stringify(posted.json)]).toEqual([200, expect.not.stringContaining('invalid')]);
    await claimElsewhere(a.id, 'ops:X-1', T0);

    const { status, json } = await show(String(a.id));
    expect(status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(['attempts', 'not_built', 'runner', 'server_time', 'window']);
    expect(json.runner).toMatchObject({ runner_id: a.id, hostname: 'host-a', alive: true, busy_elsewhere: true, profile: PROFILE });
    expect(json.runner.claim).toMatchObject({ claim_id: second.claim_id, ticket_id: 'docs:T-1', leg: 'implement', attempt: 2 });
    // The list's row, and the profile beside it.
    const listed = ((await (await sessionCall(f.cookie, '/v1/repositories/docs/runners')).json()) as Json).runners.find((r: Json) => r.runner_id === a.id);
    const { profile: _profile, ...row } = json.runner;
    expect(row).toEqual(listed);

    expect(json.attempts).toEqual([{ run: 1, claim_id: first.claim_id, runner_id: a.id, run_id: expect.stringMatching(/^r_/), started_at: T0, ended_at: T0,
      end: 'released:requested', detail: null }]);

    expect(json.window.since).toBe(T0 + 10 * 60_000 - 24 * H);
    expect(json.window.until).toBe(T0 + 10 * 60_000);
    const claims = json.window.claims as Json[];
    expect(claims.map((c) => [c.claim_id, c.ticket_id, c.end])).toEqual([[first.claim_id, 'docs:T-1', 'released'], [second.claim_id, 'docs:T-1', 'running']]);
    expect(claims[0]).toMatchObject({ leg: 'implement', started_at: T0, ended_at: T0, end_reason: 'released:requested', session_url: null, log_dir: null, activities: [] });
    expect(claims[0].runs).toEqual([{ leg: 'implement', run_id: expect.stringMatching(/^r_/), started_at: T0, ended_at: T0, reached: null, session_url: null, log_dir: null }]);
    expect(claims[1].ended_at).toBeNull();
    expect(claims[1].activities).toEqual([
      { id: 'round', parent_id: null, kind: 'review-round', label: null, source: 'skill', started_at: T0 + 11 * 60_000, ended_at: null, outcome: null, detail: null },
      { id: 'reviewer', parent_id: 'round', kind: 'reviewer', label: 'review-pr (v4)', source: 'skill', started_at: T0 + 12 * 60_000, ended_at: T0 + 13 * 60_000, outcome: 'failed', detail: { findings: 2 } },
    ]);

    // The window: a claim ended before `since` is left out.
    await setClock(T0 + 3 * H);
    expect((await heartbeat(a.key, a.hostname, a.secret, { profile: PROFILE })).status).toBe(200);
    const narrow = await show(`${a.id}?since=2h`);
    expect(narrow.status).toBe(200);
    expect(narrow.json.window.since).toBe(T0 + H);
    expect((narrow.json.window.claims as Json[]).map((c) => c.claim_id)).toEqual([second.claim_id]);
    const iso = await show(`${a.id}?since=${encodeURIComponent(new Date(T0 - H).toISOString())}`);
    expect(iso.json.window.since).toBe(T0 - H);
    expect((iso.json.window.claims as Json[]).length).toBe(2);
    expect((await show(`${a.id}?since=7d`)).status).toBe(200);

    // An owner key reads the same answer.
    const keyed = await signed(f.docsOwner, `/v1/repositories/docs/runners/${a.id}?since=2h`);
    expect(keyed.json.window).toEqual(narrow.json.window);
  });

  it('refuses a window over 7 days, a foreign runner and a segment that is no runner', async () => {
    for (const since of ['8d', '169h', 'yesterday', '0h', new Date(T0 + H).toISOString(), new Date(T0 - 8 * 24 * H).toISOString()]) {
      const r = await show(`${a.id}?since=${encodeURIComponent(since)}`);
      expect([since, r.status, r.json.code]).toEqual([since, 400, 'invalid-params']);
    }
    expect((await show(`${a.id}?limit=3`)).json.code).toBe('invalid-params');
    // Granted on ops alone: `not-found` here, the same as none.
    for (const id of [String(elsewhere.id), '999999', 'abc', '0']) {
      const r = await show(id);
      expect([id, r.status, r.json.code]).toEqual([id, 404, 'not-found']);
    }
    expect((await signed(elsewhere.key, `/v1/repositories/docs/runners/${a.id}`)).status).toBe(403);
    expect((await sessionCall(f.cookie, `/v1/repositories/ops/runners/${elsewhere.id}`)).status).toBe(200);
  });
});
