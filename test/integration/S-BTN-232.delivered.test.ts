// S-BTN-232 a ticket already delivered (BATON_SPEC §15, §5.8 R-BTN-131, R-BTN-116, R-BTN-122;
// B-257): `create-pr`'s implement finds the ticket on the default branch and its stub (the
// commit checked there — the refusal is the stub's, test/unit/course-pr.test.ts) ends the claim
// `suspended:delivered` with the commit as its evidence and the agent's line as its detail. Must
// hold: the end is no failed attempt and holds nothing; Baton's record hands the sync the run's
// `reached`, from which the station function places the ticket at `delivered` with the person leg
// `confirm` queued, confirming the end; the evidence is on the ticket's history where the person
// decides; the owner's `confirmed` queues archive, which closes at the end station;
// `filed` sends it back to implement, and a second delivered pass is placed after the loop.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { CREATE_PR_COURSE, stationsPr, type PrGraph } from '../../src/defaults/course-pr';
import type { RecordedLeg } from '../../src/defaults/pr-markers';
import type { SourceTicket } from '../../src/defaults/tickets-markdown';
import { advance, claimItem, claimRow, course, cutover, endClaim, Git, keyCall, observe, placed, register, rows, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-17T09:00:00Z');
const SHA = '8565aa7'.padEnd(40, 'c');
const DETAIL = 'delivered at 8565aa7ccc: runner-main.test.ts 47 passed, typecheck clean';
const CAP = 'runner:claim-evidence';
let git: Git;
let owner: TestKey;

const source = (id: string): SourceTicket => ({ id, course_id: 'roadmap-pr', path: `content/roadmap/${id}.mdx`, title: id, requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [], rank: 0 } as unknown as SourceTicket);
/** A sync run: the observation and Baton's record read first, then the station the CLI's station
 *  function computes for `id` from it, posted under that observation (R-BTN-62). */
async function synced(id: string) {
  const { json } = await observe();
  const legs = (json as { legs?: RecordedLeg[] }).legs ?? [];
  const st = stationsPr({ tickets: [source(id)], facts: [], closed: new Set(), graph: CREATE_PR_COURSE as unknown as PrGraph, baton: { legs } }).stations[id];
  git.place(id, st);
  const posted = await git.post({ observation: json.observation });
  return { legs, st, posted };
}
const station = (local: string) => rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', `docs:${local}`);
const answer = (local: string, option: string) =>
  keyCall(owner, '/v1/repositories/docs/attestations', { type: 'std:decision@1', subject: { ticket: local }, value: { option } });
const archiveRunner = () => register('vm-b', { capabilities: [CAP], session_name: 's-archive' });

/** A runner claims `local`'s implement and ends it as the stub's delivered answer does. */
async function delivered(local: string, cred: 'vm-a' | 'vm-b' = 'vm-a', sha = SHA, detail = DETAIL) {
  const w = await register(cred);
  const { json: c } = await claimItem(cred, w.secret, { ticket_id: `docs:${local}` });
  expect(c).toMatchObject({ station: 'filed', legs: ['implement'] });
  expect((await advance(cred, w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
  const end = await endClaim(cred, w.secret, c.claim_id, { end_reason: 'suspended:delivered', reached: 'delivered', next: 'confirm', ended_at_sha: sha, detail });
  expect(end.status).toBe(200);
  return c.claim_id as number;
}

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  git = new Git();
  git.registry = [course(3, 3, { course: CREATE_PR_COURSE })];
  git.add('D-1', {}, placed('filed', [], [['implement', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover();
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
});

describe('S-BTN-232 a ticket already delivered', () => {
  it('rejects a git answer without settling the question, then queues archive for a compatible runner', async () => {
    const claim = await delivered('D-1');
    // An outcome, not a failure (R-BTN-122): no failed attempt, no backoff, no hold.
    expect(await rows('SELECT status, failed_attempt, ended_at_sha, end_detail FROM claims WHERE id = ?', claim))
      .toEqual([{ status: 'completed', failed_attempt: 0, ended_at_sha: SHA, end_detail: DETAIL }]);
    expect(await rows('SELECT 1 FROM ticket_blocks WHERE ticket_id = ?', 'docs:D-1')).toEqual([]);
    // Baton's record carries the station the run reached; the station function places the ticket.
    const { legs, st, posted } = await synced('D-1');
    expect(legs).toContainEqual(expect.objectContaining({ ticket: 'D-1', leg: 'implement', evidence: SHA, reached: 'delivered' }));
    expect(st).toMatchObject({ station: 'delivered', path: [{ leg: 'implement', reached: 'delivered' }], next_leg: 'confirm' });
    expect(posted).toMatchObject({ status: 200, confirmed: 1 });
    expect((await claimRow(claim)).confirmed_at).not.toBeNull();
    expect(await station('D-1')).toEqual([{ station: 'delivered', next_leg: 'confirm' }]);
    // Under Needs you, the person leg with its outcomes as options; the evidence on the history.
    const needs = (await withCore((core) => core.questions.needsYou())).find((x) => x.ticket_id === 'docs:D-1');
    expect(needs).toMatchObject({ leg: 'confirm', asks: 'owner' });
    const finished = await rows<{ detail_json: string }>(`SELECT detail_json FROM ticket_history WHERE ticket_id = ? AND kind = 'leg-finished'`, 'docs:D-1');
    expect(JSON.parse(finished[0].detail_json)).toMatchObject({ end_reason: 'suspended:delivered', end_detail: DETAIL, evidence: SHA });
    // No runner may take the person's leg (rule person): the leg's word never closes the ticket.
    const w = await register('vm-b');
    expect((await claimItem('vm-b', w.secret, { ticket_id: 'docs:D-1' })).json).toMatchObject({ code: 'not-eligible', rule: 'person' });
    expect((await git.post({ attestations: [{ ticket: 'D-1', type: 'std:decision@1', ref: SHA,
      value: { id: 'confirm-1', leg: 'confirm', option: 'confirmed', reached: 'confirmed' } }] })).status).toBe(200);
    expect(await station('D-1')).toEqual([{ station: 'delivered', next_leg: 'confirm' }]);
    expect(await rows(`SELECT 1 FROM ticket_history WHERE ticket_id = 'docs:D-1' AND kind = 'arrival-unapplied' AND json_extract(detail_json, '$.why') LIKE '%directly from a person%'`)).toHaveLength(1);
    // The person confirms: archive, not another person leg, is now queued.
    const res = await answer('D-1', 'confirmed');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, reached: 'confirmed' });
    expect(await station('D-1')).toEqual([{ station: 'confirmed', next_leg: 'archive' }]);
    // The sync's next post, still reading the delivered run, does not undo the person's answer.
    expect((await synced('D-1')).posted.status).toBe(200);
    expect(await station('D-1')).toEqual([{ station: 'confirmed', next_leg: 'archive' }]);
    expect((await claimItem('vm-b', w.secret, { ticket_id: 'docs:D-1' })).json).toMatchObject({ code: 'not-eligible', rule: 4 });
    const capable = await archiveRunner();
    const { json: archive } = await claimItem('vm-b', capable.secret, { ticket_id: 'docs:D-1' });
    expect(archive).toMatchObject({ station: 'confirmed', legs: ['archive'],
      person_answer: { leg: 'confirm', option: 'confirmed', answered_by: expect.stringMatching(/^owner:/) },
      previous_attempts: [{ ended_at_sha: SHA, detail: DETAIL }] });
  });

  it('the person sends it back: implement is queued again, and a second delivered answer is placed after the loop', async () => {
    await delivered('D-1');
    expect((await synced('D-1')).posted.status).toBe(200);
    expect((await answer('D-1', 'filed')).status).toBe(200);
    expect(await station('D-1')).toEqual([{ station: 'filed', next_leg: 'implement' }]);
    expect(await rows('SELECT closed_as FROM closed_tickets WHERE ticket_id = ?', 'docs:D-1')).toEqual([]);
    // The sync still reads the delivered run as the newest; Baton's position stands.
    expect((await synced('D-1')).posted.status).toBe(200);
    expect(await station('D-1')).toEqual([{ station: 'filed', next_leg: 'implement' }]);
    // Implement runs again and finds it delivered again: the path carries the person's loop.
    const secondSha = 'b'.repeat(40);
    const secondDetail = `delivered at ${secondSha.slice(0, 10)}: verified again`;
    const second = await delivered('D-1', 'vm-b', secondSha, secondDetail);
    const { st, posted } = await synced('D-1');
    expect(st.path).toEqual([{ leg: 'implement', reached: 'delivered' }, { leg: 'confirm', reached: 'filed' }, { leg: 'implement', reached: 'delivered' }]);
    expect(posted).toMatchObject({ status: 200, confirmed: 1 });
    expect((await claimRow(second)).confirmed_at).not.toBeNull();
    expect(await station('D-1')).toEqual([{ station: 'delivered', next_leg: 'confirm' }]);
    expect(await withCore((core) => core.questions.needsYou())).toContainEqual(expect.objectContaining({ ticket_id: 'docs:D-1', leg: 'confirm' }));
    expect((await answer('D-1', 'confirmed')).status).toBe(200);
    const w = await archiveRunner();
    expect((await claimItem('vm-b', w.secret, { ticket_id: 'docs:D-1' })).json).toMatchObject({
      legs: ['archive'], previous_attempts: [{ ended_at_sha: secondSha, detail: secondDetail }, { ended_at_sha: SHA }],
    });
  });

  it('queues archive for a legacy owner confirmation when the course changes', async () => {
    const { archive: _archive, confirm, ...legs } = CREATE_PR_COURSE.legs;
    const { answer_source: _source, ...oldConfirm } = confirm;
    const { archived: _archived, ...stations } = CREATE_PR_COURSE.stations;
    git.registry = [course(4, 3, { course: { ...CREATE_PR_COURSE, end: ['merged', 'confirmed'], stations, legs: { ...legs, confirm: oldConfirm } } })];
    expect((await git.post()).status).toBe(200);
    await delivered('D-1');
    expect((await synced('D-1')).posted.status).toBe(200);
    expect((await answer('D-1', 'confirmed')).status).toBe(200);
    expect(await station('D-1')).toEqual([{ station: 'confirmed', next_leg: null }]);
    git.registry = [course(5, 3, { course: CREATE_PR_COURSE })];
    expect((await synced('D-1')).posted.status).toBe(200);
    expect(await station('D-1')).toEqual([{ station: 'confirmed', next_leg: 'archive' }]);
    const w = await archiveRunner();
    expect((await claimItem('vm-b', w.secret, { ticket_id: 'docs:D-1' })).json).toMatchObject({
      legs: ['archive'], person_answer: { option: 'confirmed' }, previous_attempts: [{ ended_at_sha: SHA }],
    });
  });
});
