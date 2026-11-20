// courseFixture.ts — the state the course-read scenarios (S-BTN-288, -289; B-197) read: docs'
// `roadmap-pr` with one leg bounded by `max_queue`, 111 tickets spread over its stations — one
// held by a claim that is running a leg, one blocked before a start and one found blocked
// during a run — a run finished three hours ago, an off-graph transition and a refused newer
// file. Built through the sync's and the runner's own routes; the two block rows and the event
// are written straight to their tables (their own routes are other scenarios').
import { expect } from 'vitest';
import { adminSession, advance, claimItem, course, cutover, endClaim, Git, keyCall, placed, register, rows, setAdminKeys, setClock } from '../helpers';
import { makeKey, type TestKey } from './sshKeys';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';

export const H = 3_600_000;
export const MANY = 105;
const digest = (c: string) => c.repeat(64);

/** The course file in force: the fixture's, its first leg bounded. */
export const FILE = { ...roadmapPr, legs: { ...roadmapPr.legs, implement: { ...roadmapPr.legs.implement, max_queue: 1 } } };

export type CourseFixture = { admin: TestKey; owner: TestKey; git: Git; cookie: string; running: { claim_id: number; runner: number }; finished: { claim_id: number; runner: number } };

export async function courseFixture(at: number): Promise<CourseFixture> {
  await setClock(at - 3 * H);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  const git = new Git();
  git.add('D1').add('E1');
  expect((await git.post()).status).toBe(200);
  await cutover(at - 3 * H);

  // Three hours ago: one run of the first leg, finished at the next station, the claim released.
  const early = await register('vm-b');
  const e = await claimItem('vm-b', early.secret, { ticket_id: 'docs:E1' });
  expect(e.status).toBe(200);
  expect((await advance('vm-b', early.secret, e.json.claim_id, { leg: 'implement' })).status).toBe(200);
  expect((await advance('vm-b', early.secret, e.json.claim_id, { reached: 'pr-open', leg: 'review' })).status).toBe(200);
  expect((await endClaim('vm-b', early.secret, e.json.claim_id, { end_reason: 'released:requested', reached: 'pr-open', next: 'review' })).status).toBe(200);

  // Now: a claim running the first leg.
  await setClock(at);
  const now = await register('vm-a');
  const d = await claimItem('vm-a', now.secret, { ticket_id: 'docs:D1' });
  expect(d.status).toBe(200);
  expect((await advance('vm-a', now.secret, d.json.claim_id, { leg: 'implement' })).status).toBe(200);

  // The board as the sync then reads it, under the bounded file.
  git.registry = [course(3, 3, { course: FILE })];
  git.place('E1', placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
  git.add('A1').add('A2');
  git.add('B1', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']], { handoff_url: 'https://example.com/handoff/B1' }));
  git.add('C1', {}, placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'waiting', 'ci']]));
  for (let i = 1; i <= MANY; i++) git.add(`T-${String(i).padStart(3, '0')}`);
  const posted = await git.post();
  expect([posted.status, (posted as { code?: string }).code]).toEqual([200, undefined]);

  // A block found before a start, and one found during the run (R-BTN-126).
  await rows(`INSERT INTO ticket_blocks (repository_id, ticket_id, leg, kind, ref, since) VALUES
              ('docs', 'docs:A2', '', 'ticket', 'docs:A1', ?), ('docs', 'docs:D1', 'implement', 'resource', 'ci', ?)`, at, at);
  // An off-graph transition (R-BTN-70), as the sync's judgement logs it.
  await rows(`INSERT INTO events (at, kind, ticket_id, actor, detail_json, repository_id) VALUES (?, 'off-graph', 'docs:C1', 'sync', '{"why":"x"}', 'docs')`, at);
  // A newer file Baton refuses: the accepted one stays in force (R-BTN-69).
  git.registry = [course(4, 3, { course: FILE, schemas: [{ id: 'roadmap-pr:either@1', digest: digest('c'), schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] } }] })];
  expect((await git.post()).status).toBe(200);
  return { admin, owner, git, cookie: await adminSession(admin), running: { claim_id: d.json.claim_id, runner: now.id }, finished: { claim_id: e.json.claim_id, runner: early.id } };
}
