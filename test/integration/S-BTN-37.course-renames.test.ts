// S-BTN-37 a course changes under a claim — the rename half (BATON_SPEC §13a, R-BTN-64, R-BTN-22;
// R3-1232): while W1 runs fix, roadmap-pr merges a course file renaming fix to address
// (`renamed_from: fix`) and adding a station, raising `version` but not `min_worker_version`.
// Must hold: W1's claim carries over — Baton rewrites its leg to address, its next advance into
// review is accepted with its earlier fix runs counted as address's, and a W2 advance still naming
// fix resolves to address; W2, still on the old version, keeps claiming. A later file that drops
// the claim's station shows `station: unknown` on the heartbeat. The removal half (R3-1248): a
// second change removes the `adjudicate` leg and the `adjudicated` station and raises
// `min_worker_version`; a third adds a loop with no `max_runs`; a fourth adds a leg leaving the
// end station. Must hold: docs' required bar (`*`
// with an `except` list) still covers the renamed leg and the second file is accepted although
// the bar's `except` names `adjudicate`; a claim at `adjudicated` gets `station: unknown` and ends
// `released:course-changed`, no failed attempt; W2, on the old version, is refused `stale-skills`
// only after the second change; the third and fourth files are refused (R-BTN-69) and listed
// under Needs you, the second staying in force. (`baton test-course` failing the second change without its
// `min_worker_version` raise is test/unit/test-course.test.ts.) Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { adminSession, advance, beat, claimItem, course, cutover, endClaim, Git, keyCall, placed, register, rows, sessionCall, setAdminKeys, setClock } from '../helpers';
import { makeKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const REVIEWED: [string, string][] = [['implement', 'pr-open'], ['review', 'reviewed']];
const { fix, ...others } = roadmapPr.legs;
/** roadmap-pr with fix renamed address, and a station `triaged` that one more leg reaches. */
const RENAMED = {
  ...roadmapPr,
  stations: { ...roadmapPr.stations, triaged: { label: 'Triaged' } },
  legs: { ...others, address: { ...fix, renamed_from: 'fix' }, triage: { from: ['triaged'], to: 'pr-open' }, park: { from: ['pr-open'], to: 'triaged', max_runs: 1 } },
};
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  git = new Git()
    .add('T-1', { rank: 1 }, placed('reviewed', REVIEWED, [['fix', 'ready']]))
    // T-2 has run fix once already, in git, before W2 claims it.
    .add('T-2', { rank: 2 }, placed('reviewed', [...REVIEWED, ['fix', 'fixed'], ['review', 'reviewed']], [['fix', 'ready']]));
  await git.post();
  await cutover();
});

describe('S-BTN-37 a course changes under a claim (renames)', () => {
  it('a renamed leg carries its claims, its runs and old names over', async () => {
    const w1 = await register('vm-a');
    const w2 = await register('vm-b');
    const c1 = (await claimItem('vm-a', w1.secret, { ticket_id: 'docs:T-1' })).json;
    const c2 = (await claimItem('vm-b', w2.secret, { ticket_id: 'docs:T-2' })).json;
    expect((await advance('vm-a', w1.secret, c1.claim_id, { leg: 'fix' })).status).toBe(200);

    // The course change merges: version 4, workers still needed at 3. The sync's stations name
    // the new leg.
    git.registry = [course(4, 3, { course: RENAMED })];
    git.place('T-1', placed('reviewed', REVIEWED, [['address', 'ready']]));
    git.place('T-2', placed('reviewed', [...REVIEWED, ['address', 'fixed'], ['review', 'reviewed']], [['address', 'ready']]));
    expect(await git.post()).toMatchObject({ status: 200 });
    expect(await rows('SELECT station, leg FROM claims WHERE id = ?', c1.claim_id)).toEqual([{ station: 'reviewed', leg: 'address' }]);
    expect((await beat('vm-a', w1.secret)).json.claim).toMatchObject({ station: 'reviewed', leg: 'address', git: { station: 'reviewed' } });

    // W1 finishes the leg it started as fix and goes on into review.
    expect((await advance('vm-a', w1.secret, c1.claim_id, { reached: 'fixed', leg: 'review' })).json).toMatchObject({ ok: true, station: 'fixed' });
    // W2's runner still says fix: it resolves to address, and the fix run in git counts — once more
    // is the second of address's two.
    expect((await advance('vm-b', w2.secret, c2.claim_id, { leg: 'fix' })).json).toMatchObject({ ok: true, station: 'reviewed' });
    expect(await rows('SELECT leg FROM claim_legs WHERE claim_id = ?', c2.claim_id)).toEqual([{ leg: 'address' }]);
    await advance('vm-b', w2.secret, c2.claim_id, { reached: 'fixed', leg: 'review' });
    expect((await advance('vm-b', w2.secret, c2.claim_id, { reached: 'reviewed', leg: 'address' })).json).toMatchObject({ code: 'not-eligible', rule_code: 'max-runs' });

    // Workers on the old version keep claiming: min_worker_version did not move.
    git.add('T-3', { rank: 3 });
    await git.post();
    const w3 = await register('test');
    expect((await claimItem('test', w3.secret, { ticket_id: 'docs:T-3' })).status).toBe(200);
  });

  it('a file that no longer has the claim’s station: the heartbeat says unknown', async () => {
    const w1 = await register('vm-a');
    const c1 = (await claimItem('vm-a', w1.secret, { ticket_id: 'docs:T-1' })).json;
    // A course whose reviewed station is gone (renamed with no renamed_from: a new station).
    const { reviewed, ...stations } = roadmapPr.stations;
    const legs = Object.fromEntries(Object.entries(roadmapPr.legs).map(([k, l]) => [k, {
      ...l, from: (l.from as string[]).map((s) => (s === 'reviewed' ? 'checked' : s)), to: l.to === 'reviewed' ? 'checked' : l.to,
    }]));
    git.registry = [course(5, 3, { course: { ...roadmapPr, stations: { ...stations, checked: reviewed }, legs } })];
    git.place('T-1', placed('checked', [['implement', 'pr-open'], ['review', 'checked']], [['fix', 'ready']]));
    git.place('T-2', placed('checked', [['implement', 'pr-open'], ['review', 'checked']], [['fix', 'ready']]));
    expect(await git.post()).toMatchObject({ status: 200 });
    expect((await beat('vm-a', w1.secret)).json.claim).toMatchObject({ station: 'reviewed', git: 'unknown' });
    expect((await advance('vm-a', w1.secret, c1.claim_id, { leg: 'fix' })).json).toMatchObject({ code: 'not-eligible', rule_code: 'off-graph' });
    // A suspension there could never be confirmed under the new file: refused (round 3, 3-A-0).
    expect((await endClaim('vm-a', w1.secret, c1.claim_id, { end_reason: 'suspended:reviewed' })).json).toMatchObject({ code: 'not-eligible', rule_code: 'off-graph' });
    // The runner ends released:course-changed, naming the station it is at though the file
    // dropped it (round 2, 2-A-1).
    expect((await endClaim('vm-a', w1.secret, c1.claim_id, { end_reason: 'released:course-changed', reached: 'reviewed' })).status).toBe(200);
  });

  it('a removal raises min_worker_version: the claim there ends course-changed, old workers stop; a loop with no max_runs is refused', async () => {
    const admin = await makeKey('ssh-ed25519', 'admin');
    const owner = await makeKey('ssh-ed25519', 'docs-owner');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
    // docs' required bar: every leg but implement, review and adjudicate bars a family.
    expect((await keyCall(owner, '/v1/owner/docs/settings', { required_bars: [{ course: 'roadmap-pr', leg: '*', except: ['implement', 'review', 'adjudicate'], tag_prefix: 'family:' }] }, 'PUT')).status).toBe(200);
    const ADJUDICATED: [string, string][] = [...REVIEWED, ['adjudicate', 'adjudicated']];
    git.add('T-3', { rank: 3 }, placed('adjudicated', ADJUDICATED, [['merge', 'ready']], { bars: { merge: ['family:glm'] } }));
    git.add('T-4', { rank: 4 });
    git.place('T-1', placed('reviewed', REVIEWED, [['fix', 'ready']], { bars: { fix: ['family:glm'] } }));
    await git.post();
    const w1 = await register('vm-a');
    const w2 = await register('vm-b'); // declares roadmap-pr at version 3

    // The first change renames fix (version 4, workers still needed at 3): W2 keeps claiming, and
    // the bar covers the renamed leg.
    git.registry = [course(4, 3, { course: RENAMED })];
    git.place('T-1', placed('reviewed', REVIEWED, [['address', 'ready']]));
    git.place('T-2', placed('reviewed', [...REVIEWED, ['address', 'fixed'], ['review', 'reviewed']], [['address', 'ready']]));
    expect(await git.post()).toMatchObject({ status: 200 });
    // posted with no family: bar, the renamed leg waits on the policy: the bar covers it
    expect(await rows(`SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = 'docs:T-1'`)).toEqual([{ leg: 'address', state: 'waiting', waiting_on: 'policy' }]);
    git.place('T-1', placed('reviewed', REVIEWED, [['address', 'ready']], { bars: { address: ['family:glm'] } }));
    await git.post();
    const c2 = (await claimItem('vm-b', w2.secret, { ticket_id: 'docs:T-1' })).json;
    expect(c2.claim_id).toBeTruthy();
    expect((await advance('vm-b', w2.secret, c2.claim_id, { leg: 'address' })).status).toBe(200);
    const c1 = (await claimItem('vm-a', w1.secret, { ticket_id: 'docs:T-3' })).json;
    expect(c1).toMatchObject({ station: 'adjudicated' });

    // The second change removes adjudicate and adjudicated, and raises min_worker_version to 5.
    const { adjudicate: _a, ...renamedLegs } = RENAMED.legs;
    const { adjudicated: _s, ...renamedStations } = RENAMED.stations;
    const REMOVED = { ...RENAMED, stations: renamedStations, legs: { ...renamedLegs, merge: { ...renamedLegs.merge, from: ['reviewed'] } } };
    git.registry = [course(5, 5, { course: REMOVED })];
    git.place('T-3', placed('reviewed', REVIEWED, [['merge', 'ready']], { bars: { merge: ['family:glm'] } }));
    expect(await git.post()).toMatchObject({ status: 200 });
    // accepted although the bar's except names adjudicate (the entry is dropped)
    expect(await rows(`SELECT version, min_worker_version FROM courses WHERE repository_id = 'docs' AND id = 'roadmap-pr'`)).toEqual([{ version: 5, min_worker_version: 5 }]);
    expect(await rows(`SELECT course_id FROM course_refusals`)).toEqual([]);
    // W1's claim at adjudicated: its station is gone. It keeps its lease, the heartbeat says
    // unknown, and it ends course-changed — no failed attempt, nothing to confirm.
    expect((await beat('vm-a', w1.secret)).json.claim).toMatchObject({ station: 'adjudicated', git: 'unknown' });
    expect((await endClaim('vm-a', w1.secret, c1.claim_id, { end_reason: 'released:course-changed', reached: 'adjudicated' })).status).toBe(200);
    expect(await rows('SELECT status, end_reason, failed_attempt FROM claims WHERE id = ?', c1.claim_id)).toEqual([{ status: 'released', end_reason: 'released:course-changed', failed_attempt: 0 }]);
    // W2, still at version 3, is refused only now — while its held claim still advances.
    expect((await advance('vm-b', w2.secret, c2.claim_id, { reached: 'fixed', leg: 'review' })).status).toBe(200);
    await endClaim('vm-b', w2.secret, c2.claim_id, { end_reason: 'released:requested' });
    expect((await claimItem('vm-b', w2.secret, { ticket_id: 'docs:T-4' })).json).toMatchObject({ code: 'stale-skills' });

    // The third change adds a loop no leg bounds: refused, listed under Needs you, the second in force.
    const LOOP = { ...REMOVED, stations: { ...REMOVED.stations, parked: { label: 'Parked' } },
      legs: { ...REMOVED.legs, park: { from: ['reviewed'], to: 'parked' }, unpark: { from: ['parked'], to: 'reviewed' } } };
    git.registry = [course(6, 5, { course: LOOP })];
    expect(await git.post()).toMatchObject({ status: 200 });
    expect(await rows(`SELECT version FROM courses WHERE repository_id = 'docs' AND id = 'roadmap-pr'`)).toEqual([{ version: 5 }]);
    const state = (await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json()) as Record<string, any>;
    expect(state.needs_you.courses_refused).toEqual([expect.objectContaining({ repository_id: 'docs', course_id: 'roadmap-pr', version: 6 })]);

    // A fourth leaves an end: `reopen` from `merged` back to `filed`, bounded, so only the
    // terminal rule (R-BTN-69, R3-1254) refuses it — a ticket at an end is done.
    const REOPEN = { ...REMOVED, legs: { ...REMOVED.legs, reopen: { from: ['merged'], to: 'filed', max_runs: 1 } } };
    git.registry = [course(7, 5, { course: REOPEN })];
    expect(await git.post()).toMatchObject({ status: 200 });
    expect(await rows(`SELECT version FROM courses WHERE repository_id = 'docs' AND id = 'roadmap-pr'`)).toEqual([{ version: 5 }]);
    const after = (await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json()) as Record<string, any>;
    expect(after.needs_you.courses_refused).toEqual([expect.objectContaining({ repository_id: 'docs', course_id: 'roadmap-pr', version: 7 })]);
  });
});
