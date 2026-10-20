// S-BTN-45 a queue over its bound (BATON_SPEC §13a, §2g R-BTN-79, R-BTN-80; R3-1255), on both
// hosts: `roadmap-pr`'s course file gives `fix` `max_queue: 2` and three reviewed tickets queue
// for it, then one is claimed. Must hold: all three enter `fix`'s queue — none is held, blocked or
// refused — and the third logs `queue-over` and queues one `queue-over` notice per `owner` courier
// with depth 3 and bound 2; meanwhile the course is `closed` — a new ticket at `filed` is not
// recommended, an expedited one is, and a claim of a new one by id is accepted
// `advice-overridden` — and the claim that drops `fix` to two closes the notices and reopens the
// course. (The block edges of S-BTN-45 are in S-BTN-45.block-edges.test.ts.)
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { Git, claimItem, course, cutover, keyCall, placed, recommended, register, rows, setAdminKeys, setClock } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { signed } from '../lib/fleet';

const T0 = Date.parse('2026-10-20T09:00:00Z');
const BOUNDED = { ...roadmapPr, legs: { ...roadmapPr.legs, fix: { ...roadmapPr.legs.fix, max_queue: 2 } } };
const REVIEWED = placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready']]);
const NEW = placed('filed', [], [['implement', 'ready']]);

let owner: TestKey;
let cli: TestKey;
let push: TestKey;
let git: Git;

const queue = async (leg: string) => (await rows<{ depth: number; max_queue: number | null }>(
  `SELECT depth, max_queue FROM leg_queues WHERE repository_id = 'docs' AND course_id = 'roadmap-pr' AND leg = ?`, leg))[0];
const events = async (kind: string) => (await rows<{ detail_json: string }>('SELECT detail_json FROM events WHERE kind = ? ORDER BY seq', kind)).map((e) => JSON.parse(e.detail_json));
const notices = () => rows<{ credential_id: string; kind: string; ref: string; state: string; ticket_id: string | null }>(
  `SELECT credential_id, kind, ref, state, ticket_id FROM notices WHERE kind = 'queue-over' ORDER BY credential_id`);

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  cli = await makeKey('ssh-ed25519', 'owner-cli');
  push = await makeKey('ssh-ed25519', 'phone-push');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  for (const k of [cli, push]) expect((await keyCall(owner, '/v1/owner/docs/couriers', { public_key: k.publicKey, asks: ['owner'] })).status).toBe(200);
  git = new Git();
  git.registry = [course(3, 3, { course: BOUNDED })];
  git.add('A', {}, REVIEWED).add('B', {}, REVIEWED).add('N', {}, NEW).add('X', { expedite: true }, NEW);
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-45 a queue over its bound', () => {
  it('the third ticket enters and warns; the course closes its intake; a claim drains it and reopens', async () => {
    expect(await queue('fix')).toEqual({ depth: 2, max_queue: 2 });
    expect(await notices()).toEqual([]);

    // The third reviewed ticket enters fix's queue: nothing holds, blocks or refuses it.
    git.add('C', {}, REVIEWED);
    expect((await git.post()).status).toBe(200);
    expect(await queue('fix')).toEqual({ depth: 3, max_queue: 2 });
    expect(await rows(`SELECT id FROM tickets WHERE blocked_since IS NOT NULL`)).toEqual([]);
    expect(await events('queue-over')).toEqual([{ course: 'roadmap-pr', leg: 'fix', depth: 3, max_queue: 2 }]);
    expect(await events('course-closed')).toEqual([{ course: 'roadmap-pr' }]);
    // One notice per owner courier, on no ticket.
    expect(await notices()).toEqual([cli.fingerprint, push.fingerprint].sort().map((credential_id) =>
      ({ credential_id, kind: 'queue-over', ref: 'roadmap-pr:fix', state: 'queued', ticket_id: null })));
    expect((await signed(cli, '/v1/courier/notices/claim', { body: {} })).json.notices).toEqual([{ notice_id: expect.stringMatching(/^[0-9a-f]{32}$/),
      kind: 'queue-over', repository: 'docs', course: 'roadmap-pr', leg: 'fix', depth: 3, max_queue: 2, intake: 'closed', created_at: T0 }]);

    // Closed: the new ticket N is not recommended; the expedited X still is; the three in it go on.
    const w1 = await register('vm-a');
    const recs = await recommended(w1.id);
    expect(recs).toEqual(expect.arrayContaining(['docs:A', 'docs:B', 'docs:C', 'docs:X']));
    expect(recs).not.toContain('docs:N');
    // Advice, not a gate: a claim of N by id is accepted, recorded advice-overridden.
    const n = await claimItem('vm-a', w1.secret, { ticket_id: 'docs:N' });
    expect(n.status).toBe(200);
    expect((await events('advice-overridden')).at(-1).overridden).toEqual(expect.arrayContaining([{ advice: 'intake', course: 'roadmap-pr' }]));

    // The claim that drops fix to two closes the notices and reopens the course.
    const w2 = await register('vm-b');
    expect((await claimItem('vm-b', w2.secret, { ticket_id: 'docs:A' })).status).toBe(200);
    expect(await queue('fix')).toEqual({ depth: 2, max_queue: 2 });
    expect((await notices()).map((x) => x.state)).toEqual(['closed', 'closed']);
    expect(await events('course-opened')).toEqual([{ course: 'roadmap-pr' }]);
    expect(await events('queue-over')).toHaveLength(1);
  });
});
