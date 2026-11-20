// S-BTN-260 the tickets list (B-194; BATON_SPEC §11.4, §14): `GET …/tickets` (`repo.tickets`)
// lists every live ticket under its one state word by the one precedence, with the other words
// that apply as `reasons`, the state's `detail`, its position, and counts per state. Must hold:
//   1. a ready, two running (one stalled, one waiting on a condition), a held-and-blocked, two
//      blocked (one on a capability no live runner declares), a backing-off, an unconfirmed, a suspended, a person-waiting and a closed-today
//      ticket each get their state and its detail — the held-and-blocked one is `held` with
//      `reasons: ["blocked"]`;
//   2. the ready tickets come first in the board's order, each naming its eligible live runners
//      by name; one above every live runner's tier ceiling has an empty list and the gate's
//      rule word;
//   3. `?state=blocked` is the tab's five words, `?state=closed-today` is `closed`; `?q=` and
//      `?tier=` filter; `counts` and nothing else ignore the filters; a bad query is
//      `invalid-params`;
//   4. pages chain by `next_cursor` with no row twice; a cursor of another filter is refused;
//   5. an owner's key reads the same rows as the session.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { adminSession, claimItem, course, cutover, Git, keyCall, ORIGIN, placed, register, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const HOUR = 3_600_000;
const REVIEWED: [string, string][] = [['implement', 'pr-open'], ['review', 'reviewed']];
const PERSON = {
  ...roadmapPr,
  legs: { ...roadmapPr.legs, decide: { from: ['reviewed'], to: ['adjudicated'], kind: 'person', asks: 'owner' } as Record<string, unknown> },
};

type Row = Record<string, any>;
let admin: TestKey;
let owner: TestKey;
let cookie: string;
let git: Git;

async function get(path: string): Promise<{ status: number; json: Row }> {
  const res = await sessionCall(cookie, path);
  return { status: res.status, json: (await res.json()) as Row };
}
const tickets = async (query = ''): Promise<Row> => {
  const res = await get(`/v1/repositories/docs/tickets${query}`);
  expect(res.status).toBe(200);
  return res.json;
};
const byId = (answer: Row, local: string): Row => (answer.tickets as Row[]).find((t) => t.ticket_id === `docs:${local}`)!;
const ids = (answer: Row): string[] => (answer.tickets as Row[]).map((t) => (t.ticket_id as string).slice('docs:'.length));

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  git = new Git();
  git.registry = [course(3, 3, { course: PERSON })];
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  cookie = await adminSession(admin);
});

/** The fixture repository of the scenario; returns the runners and claims it made. */
async function fixture() {
  git.add('R', { rank: 1 });
  git.add('K', { rank: 2, tier: 'critical' });
  git.add('N', { rank: 12, requires: ['real-iphone'] });
  git.add('RUN1', { rank: 3 });
  git.add('RUN2', { rank: 4 });
  git.add('HB', { rank: 5 });
  git.add('B', { rank: 6 });
  git.add('BO', { rank: 7 });
  git.add('U', { rank: 8 });
  git.add('S', { rank: 9, tier: 'critical' }, placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'ci']]));
  git.add('P', { rank: 10, question: { id: 'q-1', severity: 'high', options: [{ id: 'ship', reached: 'adjudicated' }] } }, placed('reviewed', REVIEWED, [['decide', 'ready']]));
  git.add('C', { rank: 11 });
  expect((await git.post()).status).toBe(200);
  git.close('C', 'done');
  expect((await git.post()).status).toBe(200);

  // Every runner's ceiling is `routine`: none may take the critical K.
  const a = await register('vm-a', { tier_ceiling: 'routine' });
  const b = await register('vm-b', { tier_ceiling: 'routine' });
  const idle = await register('mac', { tier_ceiling: 'routine' });
  const run1 = await claimItem('vm-a', a.secret, { ticket_id: 'docs:RUN1' });
  const run2 = await claimItem('vm-b', b.secret, { ticket_id: 'docs:RUN2' });
  expect([run1.status, run2.status]).toEqual([200, 200]);
  // RUN1's runner is alive and silent for three hours: stalled. RUN2's leg waits on a condition.
  await rows('UPDATE runners SET last_activity_at = ? WHERE id = ?', T0 - 3 * HOUR, a.id);
  await rows(`INSERT INTO conditions (repository_id, ticket_id, claim_id, run_id, leg, type, disposition, severity, restarts_json, raised_at, outcome)
              VALUES ('docs', 'docs:RUN2', ?, 'r_1', 'implement', 'x.wait', 'interrupt', 'normal', '{}', ?, 'open')`, run2.json.claim_id, T0);
  const waits = (await rows<{ id: number }>(`SELECT id FROM conditions WHERE ticket_id = 'docs:RUN2'`))[0].id;
  // HB is held by the owner and blocked on another ticket; B is blocked alone.
  const hold = await sessionCall(cookie, `/v1/ui/overrides/${encodeURIComponent('docs:HB')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hold: true }) });
  expect(hold.status).toBe(200);
  for (const t of ['docs:HB', 'docs:B']) {
    await rows(`INSERT INTO ticket_blocks (repository_id, ticket_id, leg, kind, ref, since) VALUES ('docs', ?, '', 'ticket', 'docs:R', ?)`, t, T0 - HOUR);
    await rows('UPDATE tickets SET blocked_since = ? WHERE id = ?', T0 - HOUR, t);
  }
  // BO backs off for an hour; U's completion is not confirmed.
  await rows(`INSERT INTO ticket_overrides (ticket_id, expedite, hold, hold_reason, retry_after, set_by, set_at) VALUES ('docs:BO', 0, 0, NULL, ?, 'baton', ?)`, T0 + HOUR, T0);
  await rows(`INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason, ended_at_sha)
              VALUES ('docs:U', ?, 'seed:U', 'abc123', '', ?, 'completed', ?, 'done', ?)`, idle.id, T0 - HOUR, T0 - 60_000, 'c'.repeat(40));
  return { a, b, idle, run1: run1.json.claim_id as number, run2: run2.json.claim_id as number, waits };
}

describe('S-BTN-260 the tickets list (B-194)', () => {
  it('gives each ticket one state word by precedence, its reasons and its detail', async () => {
    const f = await fixture();
    const answer = await tickets();
    expect(Object.keys(answer).sort()).toEqual(['counts', 'matched', 'server_time', 'tickets']);
    const state = (local: string) => [byId(answer, local).state, byId(answer, local).reasons];
    expect(state('R')).toEqual(['ready', []]);
    expect(state('K')).toEqual(['ready', []]);
    // Baton's own block: no live runner granted on the repository declares what N requires.
    expect(state('N')).toEqual(['blocked', []]);
    expect(byId(answer, 'N').detail).toMatchObject({ kind: 'capability', ref: 'real-iphone' });
    expect([byId(answer, 'N').requires, byId(answer, 'N').requires_unmet]).toEqual([['real-iphone'], ['real-iphone']]);
    expect(state('RUN1')).toEqual(['running', []]);
    expect(state('RUN2')).toEqual(['running', []]);
    expect(state('HB')).toEqual(['held', ['blocked']]);
    expect(state('B')).toEqual(['blocked', []]);
    expect(state('BO')).toEqual(['backing-off', []]);
    expect(state('U')).toEqual(['unconfirmed', []]);
    expect(state('S')).toEqual(['suspended', []]);
    expect(state('P')).toEqual(['waiting-person', []]);
    expect(state('C')).toEqual(['closed', []]);

    const r = byId(answer, 'R');
    expect(Object.keys(r).sort()).toEqual(['course', 'detail', 'eligible_runners', 'expedite', 'failed_rule', 'order', 'parent', 'position', 'reasons', 'requires', 'requires_unmet', 'state', 'tags', 'ticket_id', 'tier', 'title']);
    expect([r.title, r.course, r.tier, r.position]).toEqual(['R — a fixture ticket', 'roadmap-pr', 'routine', { station: 'filed', path_len: 0, next_leg: 'implement' }]);

    const run1 = byId(answer, 'RUN1').detail;
    expect(run1).toMatchObject({ claim_id: f.run1, runner_id: f.a.id, hostname: 'vm-a', session_name: 's-vm-a', leg: 'implement', since: T0, alive: true, stalled: true, condition_wait: null, last_activity_at: T0 - 3 * HOUR });
    expect(run1.lease_ends_at).toBeGreaterThan(T0);
    expect(byId(answer, 'RUN2').detail).toMatchObject({ claim_id: f.run2, runner_id: f.b.id, stalled: false, condition_wait: f.waits });
    const fp = (await rows<{ set_by: string }>(`SELECT set_by FROM ticket_overrides WHERE ticket_id = 'docs:HB'`))[0].set_by;
    expect(byId(answer, 'HB').detail).toEqual({ set_by: fp, reason: 'owner', since: T0 });
    expect(fp.startsWith('owner:')).toBe(true);
    expect(byId(answer, 'B').detail).toEqual({ kind: 'ticket', ref: 'docs:R', since: T0 - HOUR });
    expect(byId(answer, 'BO').detail).toEqual({ attempt: 0, max_runs: 3, until: T0 + HOUR });
    expect(byId(answer, 'U').detail).toMatchObject({ reported_at: T0 - 60_000, runner_id: f.idle.id, hostname: 'owner-mac' });
    expect(byId(answer, 'S').detail).toEqual({ station: 'pr-open', waits_for: 'ci' });
    expect(byId(answer, 'P').detail).toEqual({ leg: 'decide', question_id: 'q-1' });
    const c = byId(answer, 'C');
    expect([c.title, c.detail]).toEqual([null, { at: T0, end: 'done' }]);

    expect(answer.counts).toEqual({ unconfirmed: 1, running: 2, 'waiting-person': 1, held: 1, blocked: 2, 'backing-off': 1, suspended: 1, ready: 2, closed: 1, total: 12 });
    expect(answer.matched).toBe(12);
    // Ready first in the board's order, then the others by precedence and id, the closed last.
    expect(ids(answer)).toEqual(['R', 'K', 'U', 'RUN1', 'RUN2', 'P', 'HB', 'B', 'N', 'BO', 'S', 'C']);
    const board = (await get('/v1/repositories/docs/board')).json;
    // The board's `ready` is every leg posted ready, the claimed and the held included: the
    // tickets whose state is `ready` keep its order.
    expect(ids(answer).slice(0, 2)).toEqual((board.ready as Row[]).map((t) => t.local_id).filter((id) => id === 'R' || id === 'K'));

    // A closure older than a day is no longer listed.
    await rows(`UPDATE closed_tickets SET closed_at = ? WHERE ticket_id = 'docs:C'`, T0 - 25 * HOUR);
    const later = await tickets();
    expect(ids(later)).not.toContain('C');
    expect(later.counts.closed).toBe(0);
  });

  it('names a ready ticket’s eligible runners, and the rule word where none can take it', async () => {
    const f = await fixture();
    const answer = await tickets('?state=ready');
    expect(ids(answer)).toEqual(['R', 'K']);
    const r = byId(answer, 'R');
    expect(r.failed_rule).toBeNull();
    expect(r.eligible_runners).toContainEqual({ runner_id: f.idle.id, hostname: 'owner-mac', session_name: 's-mac' });
    const k = byId(answer, 'K');
    expect([k.eligible_runners, k.failed_rule]).toEqual([[], 'above-tier-ceiling']);
    // A row that is not ready carries neither field.
    expect('eligible_runners' in byId(await tickets(), 'HB')).toBe(false);
    // With no live runner at all the list is empty and the word says so.
    await setClock(T0 + 2 * HOUR);
    const none = byId(await tickets('?state=ready'), 'R');
    expect([none.eligible_runners, none.failed_rule]).toEqual([[], 'no-runner']);
  });

  it('filters by state word, tab, text and tier; counts ignore the filters; a bad query is refused', async () => {
    await fixture();
    const all = await tickets();
    const blocked = await tickets('?state=blocked');
    expect(ids(blocked).sort()).toEqual(['B', 'BO', 'HB', 'N', 'P', 'S']);
    expect(blocked.counts).toEqual(all.counts);
    expect(blocked.matched).toBe(6);
    expect(ids(await tickets('?state=held'))).toEqual(['HB']);
    expect(ids(await tickets('?state=closed-today'))).toEqual(['C']);
    expect(ids(await tickets('?state=running'))).toEqual(['RUN1', 'RUN2']);
    expect(ids(await tickets('?state=unconfirmed'))).toEqual(['U']);
    // `q`: a case-insensitive substring of the id or the title, matched and never interpreted.
    expect(ids(await tickets('?q=run'))).toEqual(['RUN1', 'RUN2']);
    expect(ids(await tickets(`?q=${encodeURIComponent('BO — a fixture')}`))).toEqual(['BO']);
    expect(ids(await tickets(`?q=${encodeURIComponent('%')}`))).toEqual([]);
    // `tier`: a ceiling — the critical ticket is above `routine`; a row with no ticket fits none.
    const routine = await tickets('?tier=routine');
    expect(ids(routine)).not.toContain('S');
    expect(ids(routine)).not.toContain('K');
    expect(ids(routine)).not.toContain('C');
    expect(ids(routine)).toContain('R');
    expect(ids(await tickets('?tier=critical'))).toContain('S');
    expect(routine.counts).toEqual(all.counts);
    expect(ids(await tickets('?state=blocked&q=b&tier=routine')).sort()).toEqual(['B', 'BO', 'HB']);

    for (const bad of ['?state=nope', '?tier=zzz', '?bogus=1', '?q=', '?cursor=garbage']) {
      const res = await get(`/v1/repositories/docs/tickets${bad}`);
      expect([bad, res.status, res.json.code]).toEqual([bad, 400, 'invalid-params']);
    }
  });

  it('pages chain by cursor, and an owner’s key reads the session’s rows', async () => {
    for (let i = 0; i < 103; i++) git.add(`T-${String(i).padStart(3, '0')}`, { rank: i });
    expect((await git.post()).status).toBe(200);
    const one = await tickets();
    expect(one.tickets.length).toBe(100);
    expect(typeof one.next_cursor).toBe('string');
    expect(one.matched).toBe(103);
    const two = await tickets(`?cursor=${encodeURIComponent(one.next_cursor)}`);
    expect(two.tickets.length).toBe(3);
    expect('next_cursor' in two).toBe(false);
    expect(new Set([...ids(one), ...ids(two)]).size).toBe(103);
    expect(ids(two)).toEqual(['T-100', 'T-101', 'T-102']);
    // A cursor is its own query's: another filter refuses it.
    const other = await get(`/v1/repositories/docs/tickets?state=ready&cursor=${encodeURIComponent(one.next_cursor)}`);
    expect([other.status, other.json.code]).toEqual([400, 'invalid-params']);

    const created = Math.floor((await withCore((c) => c.now())) / 1000);
    const keyed = await hostCall(await signedRequest(owner, `${ORIGIN}/v1/repositories/docs/tickets?state=suspended`, { created }));
    expect(keyed.status).toBe(200);
    expect(((await keyed.json()) as Row).counts).toEqual(one.counts);
    const stranger = await hostCall(await signedRequest(await makeKey('ssh-ed25519', 'stranger'), `${ORIGIN}/v1/repositories/docs/tickets`, { created }));
    expect(stranger.status).toBe(401);
    const foreign = await get('/v1/repositories/nope/tickets');
    expect([foreign.status, foreign.json.code]).toEqual([403, 'forbidden']);
  });
});
