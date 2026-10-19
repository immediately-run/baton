// S-BTN-47 positions, course changes and the dead-ticket queue (BATON_SPEC §13a, §2h R-BTN-81,
// R-BTN-83, R-BTN-85, §2g R-BTN-78; R3-1257), on both hosts — the half R3-1257 builds. The holder's
// provisional position, the owner's re-route and the discrepancies they log are B-38's half.
// In `docs`: a human pushes work with no marker; the course adds a `squash-merge` leg out of
// `reviewed`, and later removes `adjudicate` while a ticket is queued for it; a ticket's retries
// are spent (a `cannot-finish:spec` end holds it at once), and another's queued leg waits 72 hours.
// Must hold: the unmarked work is posted `inferred` and recorded as `git-moved`; tickets queued
// for `merge` keep it; the ticket queued for the removed leg waits on `course-changed` under Needs
// you; Baton raises `baton:retries` and `baton:stalled` (the latter only for a leg posted waiting
// 72 hours, closing by itself when posted ready), each blocking its ticket with an `owner` notice,
// listed by `blocked?on=decision:baton:*`; a posted `baton:x` is dropped; and `baton owner resolve
// … retry` clears one and unblocks the ticket.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, adminSession, course, cutover, keyCall, placed, rows, sessionCall, setAdminKeys, setClock, tick } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { grantedWorker, signed } from '../lib/fleet';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const REVIEWED: [string, string][] = [['implement', 'pr-open'], ['review', 'reviewed']];

let admin: TestKey;
let owner: TestKey;
let cli: TestKey;
let git: Git;

const queued = (local: string) => rows<{ next_leg: string | null; next_source: string }>('SELECT next_leg, next_source FROM ticket_stations WHERE ticket_id = ?', `docs:${local}`);
const nextLegs = (local: string) => rows<{ leg: string; state: string; waiting_on: string | null }>('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', `docs:${local}`);
const history = async (local: string, as: TestKey = owner) => (await signed(as, `/v1/repositories/docs/tickets/${local}/history`, { method: 'GET' })).json;
const decisions = (local: string) => rows<{ decision_id: string; source: string }>('SELECT decision_id, source FROM ticket_decisions WHERE ticket_id = ? ORDER BY decision_id', `docs:${local}`);
const needsYou = async () => ((await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json()) as { needs_you: Record<string, unknown[]> }).needs_you;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  cli = await makeKey('ssh-ed25519', 'owner-cli');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(owner, '/v1/owner/docs/couriers', { public_key: cli.publicKey, asks: ['owner'] })).status).toBe(200);
  git = new Git()
    .add('A', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]))
    .add('M', {}, placed('reviewed', REVIEWED, [['merge', 'ready']], { bars: { merge: ['family:glm'] } }))
    .add('J', {}, placed('reviewed', REVIEWED, [['adjudicate', 'ready']]))
    .add('R')
    .add('S', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'ci']]));
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
});

describe('S-BTN-47 positions, course changes and the dead-ticket queue', () => {
  it('work git shows without a marker is posted inferred and recorded as git moving the ticket', async () => {
    await setClock(T0 + MIN);
    git.place('A', placed('reviewed', REVIEWED, [['merge', 'ready']], { next_source: 'inferred' }));
    expect((await git.post()).status).toBe(200);
    expect(await queued('A')).toEqual([{ next_leg: 'merge', next_source: 'inferred' }]);
    expect((await history('A')).rows).toEqual([expect.objectContaining({
      kind: 'git-moved', reached: 'reviewed', next_leg: 'merge', at: T0 + MIN,
      detail: { from: 'pr-open', to: 'reviewed', path: REVIEWED.map(([leg, reached]) => ({ leg, reached })), observation: expect.any(Number), next_source: 'inferred' },
    })]);
  });

  it('a leg added later changes no queued leg; a removed queued leg waits on course-changed under Needs you', async () => {
    // The course adds squash-merge out of `reviewed`: M stays queued for merge.
    const ADDED = { ...roadmapPr, legs: { ...roadmapPr.legs, 'squash-merge': { from: ['reviewed'], to: 'merged' } } };
    git.registry = [course(4, 3, { course: ADDED })];
    expect((await git.post()).status).toBe(200);
    expect(await queued('M')).toEqual([{ next_leg: 'merge', next_source: 'marker' }]);
    expect(await nextLegs('M')).toEqual([{ leg: 'merge', state: 'ready', waiting_on: null }]);

    // It then removes adjudicate (and the station it reaches) while J is queued for it. The file is
    // accepted, J's queued leg waits on course-changed — the snapshot posting it ready is not refused
    // and does not override the wait — and Needs you lists it.
    await setClock(T0 + 2 * MIN);
    const { adjudicate: _a, ...legs } = ADDED.legs;
    const { adjudicated: _s, ...stations } = ADDED.stations;
    const REMOVED = { ...ADDED, stations, legs: { ...legs, merge: { ...legs.merge, from: ['reviewed'] } } };
    git.registry = [course(5, 5, { course: REMOVED })];
    expect((await git.post()).status).toBe(200);
    expect(await queued('J')).toEqual([{ next_leg: 'adjudicate', next_source: 'marker' }]);
    expect(await nextLegs('J')).toEqual([{ leg: 'adjudicate', state: 'waiting', waiting_on: 'course-changed' }]);
    expect(await rows(`SELECT kind FROM events WHERE ticket_id = 'docs:J' AND kind = 'off-graph'`)).toEqual([]);
    expect((await needsYou()).course_changed).toEqual([{ ticket_id: 'docs:J', leg: 'adjudicate', waiting_since: T0 + 2 * MIN }]);
    // A worker is never offered it.
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue']);
    expect((await w.call('/v1/runner/claim', { request_id: 'req-claim-j', ticket_id: 'docs:J' })).status).toBe(409);
    // The sync's own fix — git posts J at reviewed queued for merge — clears the wait.
    git.place('J', placed('reviewed', REVIEWED, [['merge', 'ready']], { bars: { merge: ['family:glm'] } }));
    expect((await git.post()).status).toBe(200);
    expect(await nextLegs('J')).toEqual([{ leg: 'merge', state: 'ready', waiting_on: null }]);
    expect((await needsYou()).course_changed).toEqual([]);
  });

  it('retries spent raise baton:retries with an owner notice; a posted baton: id is dropped; resolve retry unblocks', async () => {
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue']);
    const c = await w.call('/v1/runner/claim', { request_id: 'req-claim-r', ticket_id: 'docs:R' });
    expect(c.status).toBe(200);
    expect((await w.call('/v1/runner/claims/' + c.json.claim_id + '/advance', { leg: 'implement' })).status).toBe(200);
    // `cannot-finish:spec` is non-retryable: the ticket is held at once and the hold is put to the owner.
    expect((await w.call(`/v1/runner/claims/${c.json.claim_id}/end`, { end_reason: 'released:cannot-finish:spec' })).status).toBe(200);
    expect(await rows(`SELECT hold, hold_reason FROM ticket_overrides WHERE ticket_id = 'docs:R'`)).toEqual([{ hold: 1, hold_reason: 'non-retryable:spec' }]);
    expect(await decisions('R')).toEqual([{ decision_id: 'baton:retries', source: 'baton' }]);
    expect(await rows(`SELECT credential_id, ref, state FROM notices WHERE ticket_id = 'docs:R'`)).toEqual([{ credential_id: cli.fingerprint, ref: 'baton:retries', state: 'queued' }]);
    const deadQueue = (await signed(owner, `/v1/repositories/docs/blocked?on=${encodeURIComponent('decision:*')}`, { method: 'GET' })).json;
    expect(deadQueue.tickets.map((t: { ticket_id: string }) => t.ticket_id)).toEqual(['docs:R']);
    // The history, newest first: the run, its end, the decision and the block it put on the ticket.
    expect((await history('R')).rows.map((r: { kind: string }) => r.kind)).toEqual(['blocked', 'decision-opened', 'leg-abandoned', 'leg-started']);
    expect((await history('R')).rows[2]).toMatchObject({ kind: 'leg-abandoned', leg: 'implement', run: 1, claim_id: c.json.claim_id, detail: { end_reason: 'released:cannot-finish:spec' } });

    // A sync posting a decision under Baton's reserved prefix has it dropped; Baton's own stays.
    git.place('R', placed('filed', [], [['implement', 'ready']], { decisions: [{ id: 'baton:x', asks: 'owner' }] }));
    expect(((await git.post()) as { dropped?: string[] }).dropped).toEqual(['docs:R:decision:baton:x']);
    expect(await decisions('R')).toEqual([{ decision_id: 'baton:retries', source: 'baton' }]);

    // The owner answers retry: the hold lifts, the decision and its notice close, the ticket unblocks.
    await setClock(T0 + 5 * MIN);
    const r = await keyCall(owner, '/v1/owner/docs/tickets/docs%3AR/resolve', { decision: 'baton:retries', answer: 'retry' });
    expect(r).toMatchObject({ status: 200, json: { ok: true } });
    expect(await rows(`SELECT hold FROM ticket_overrides WHERE ticket_id = 'docs:R'`)).toEqual([{ hold: 0 }]);
    expect(await decisions('R')).toEqual([]);
    expect(await rows(`SELECT state FROM notices WHERE ticket_id = 'docs:R'`)).toEqual([{ state: 'closed' }]);
    const unblocked = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE ticket_id = 'docs:R' AND kind = 'unblocked'`);
    expect(unblocked.map((e) => JSON.parse(e.detail_json))).toEqual([{ ticket: 'docs:R', cleared: [expect.objectContaining({ kind: 'decision', ref: 'baton:retries' })] }]);
    expect((await history('R')).rows[0]).toMatchObject({ kind: 'unblocked' });
    // Answered once: a second answer finds none.
    expect((await keyCall(owner, '/v1/owner/docs/tickets/docs%3AR/resolve', { decision: 'baton:retries', answer: 'retry' })).json.code).toBe('not-found');
  });

  it('a queued leg posted waiting for 72 hours raises baton:stalled, which closes when it is posted ready', async () => {
    // S's review waits on ci from T0; 72 hours on, the alarm raises baton:stalled.
    await setClock(T0 + 72 * H - MIN);
    await tick();
    expect(await decisions('S')).toEqual([]);
    await setClock(T0 + 72 * H);
    await tick();
    expect(await decisions('S')).toEqual([{ decision_id: 'baton:stalled', source: 'baton' }]);
    expect(await rows(`SELECT ref FROM notices WHERE ticket_id = 'docs:S' AND state = 'queued'`)).toEqual([{ ref: 'baton:stalled' }]);
    expect((await signed(owner, `/v1/repositories/docs/blocked?on=${encodeURIComponent('decision:baton:stalled')}`, { method: 'GET' })).json.tickets
      .map((t: { ticket_id: string }) => t.ticket_id)).toEqual(['docs:S']);
    // A wait Baton stores itself raises none: J's course-changed (from the previous case) is not here,
    // and a ticket an owner holds is skipped — covered in the unit tests.
    git.place('S', placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect(await decisions('S')).toEqual([]);
    expect(await rows(`SELECT state FROM notices WHERE ticket_id = 'docs:S'`)).toEqual([{ state: 'closed' }]);
  });
});
