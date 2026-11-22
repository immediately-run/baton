// S-BTN-310 a course that starts with a person's conversation (BATON_SPEC §15, §5.8 R-BTN-131,
// §6.4 R-BTN-116, R-BTN-39): `bug-fix` and `new-feature` are `create-pr` behind a person leg —
// `describe`, `specify` — that a person works in their own interactive session at once. Must
// hold: a new ticket is placed at the course's start with the person leg queued and listed under
// Needs you; no runner is offered it or may claim it (rule `person`), so nothing waits for one;
// the person's answer through Baton moves it to `filed` and queues `implement` for runners; the
// sync's next post, still placing it at the start, does not undo the answer — a runner's
// `implement` claim takes it from there; and once a PR stands, the station function's path (the
// person leg's step in front of `create-pr`'s) extends the one the answer left. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { BUG_FIX_COURSE, BUG_FIX_START, stationsConversationPr, type PrFact, type PrGraph } from '../../src/defaults/course-pr';
import type { SourceTicket } from '../../src/defaults/tickets-markdown';
import { advance, claimItem, course, cutover, endClaim, Git, keyCall, observe, placed, register, rows, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-22T09:00:00Z');
let git: Git;
let owner: TestKey;

const source = (id: string): SourceTicket => ({ id, course_id: 'roadmap-pr', path: `tickets/${id}.mdx`, title: id, requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [], rank: 0 } as unknown as SourceTicket);
/** A sync run: the station the CLI's `bug-fix` station function computes for `id` from the
 *  forge's PRs, posted under a fresh observation (R-BTN-62). */
async function synced(id: string, facts: PrFact[] = []) {
  const { json } = await observe();
  const st = stationsConversationPr(BUG_FIX_START, { tickets: [source(id)], facts, closed: new Set(), branchPatterns: ['claude/{ticket}-*'], graph: BUG_FIX_COURSE as unknown as PrGraph }).stations[id];
  git.place(id, st);
  return { st, posted: await git.post({ observation: json.observation }) };
}
const station = (local: string) => rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', `docs:${local}`);
const answer = (local: string, option: string) =>
  keyCall(owner, '/v1/repositories/docs/attestations', { type: 'std:decision@1', subject: { ticket: local }, value: { option } });

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  git = new Git();
  git.registry = [course(3, 3, { course: BUG_FIX_COURSE })];
  git.add('D-1', {}, placed('reported', [], [['describe', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover();
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
});

describe('S-BTN-310 a course that starts with a person\'s conversation', () => {
  it('the conversation is the person\'s at once: on Needs you, never a runner\'s; their answer queues implement, and a stale post does not undo it', async () => {
    // The station function places a ticket with no PR at the start, the person leg queued.
    expect((await synced('D-1')).st).toMatchObject({ station: 'reported', path: [], next_leg: 'describe' });
    expect(await station('D-1')).toEqual([{ station: 'reported', next_leg: 'describe' }]);
    const needs = (await withCore((core) => core.questions.needsYou())).find((x) => x.ticket_id === 'docs:D-1');
    expect(needs).toMatchObject({ leg: 'describe', asks: 'reporter' });
    // No runner may take the conversation (rule person): nothing waits for one to pick it up.
    const w = await register('vm-a');
    expect((await claimItem('vm-a', w.secret, { ticket_id: 'docs:D-1' })).json).toMatchObject({ code: 'not-eligible', rule: 'person' });
    // The person answers when the ticket reads whole: it moves to `filed`, implement queued.
    const res = await answer('D-1', 'filed');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, reached: 'filed' });
    expect(await station('D-1')).toEqual([{ station: 'filed', next_leg: 'implement' }]);
    // The sync's next post still places it at the start: Baton's position stands (R-BTN-39).
    expect((await synced('D-1')).posted.status).toBe(200);
    expect(await station('D-1')).toEqual([{ station: 'filed', next_leg: 'implement' }]);
    // A runner takes implement from there.
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:D-1' });
    expect(c).toMatchObject({ station: 'filed', legs: ['implement'] });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'done', reached: 'pr-open', next: 'run-tests' })).status).toBe(200);
    // The PR's post: the person leg's step in front of create-pr's, extending the answer's path.
    const pr: PrFact = { number: 3, head: 'claude/D-1-fix', state: 'open', pushedAt: T0, checks: [], reviews: [] };
    const { st, posted } = await synced('D-1', [pr]);
    expect(st.path).toEqual([{ leg: 'describe', reached: 'filed' }, { leg: 'implement', reached: 'pr-open' }]);
    expect(posted.status).toBe(200);
    expect(await station('D-1')).toEqual([{ station: 'pr-open', next_leg: 'run-tests' }]);
    expect(await rows(`SELECT 1 FROM events WHERE ticket_id = ? AND kind = 'off-graph'`, 'docs:D-1')).toEqual([]);
  });

  it('a released implement leaves the ticket at filed: the stale post at the start does not send it back to the conversation', async () => {
    expect((await answer('D-1', 'filed')).status).toBe(200);
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:D-1' });
    expect(c).toMatchObject({ station: 'filed', legs: ['implement'] });
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:cannot-finish:transient' })).status).toBe(200);
    expect((await synced('D-1')).posted.status).toBe(200);
    expect(await station('D-1')).toEqual([{ station: 'filed', next_leg: 'implement' }]);
  });
});
