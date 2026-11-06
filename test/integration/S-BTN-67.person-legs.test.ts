// S-BTN-67 a person's leg (BATON_SPEC §15, §6.4 R-BTN-116; B-7): a queued `kind: person` leg;
// its question posted with options; a question posted for a ticket whose queued leg is an
// agent's; a runner asks; the owner answers in git under `cooperative`, and with
// `baton decision answer`; an answer naming an option the question lacks; a person leg with
// `expires`, unanswered, then answered after the instant. Must hold: stored with its question and
// listed under Needs you; the stray question dropped, `question-dropped`; refused (rule
// `person`); the leg arriving from its `std:decision@1` as a `fact-arrival`, the answer its
// output; `invalid-params` from the CLI, the sync's dropped `answer-invalid`; the expiry arriving
// at `reached` with `question-expired`, the late answer `arrival-unapplied`. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { answerPlan } from '../../cli/baton.mjs';
import { claimItem, course, cutover, Git, keyCall, placed, register, rows, setAdminKeys, setClock, tick, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-04T09:00:00Z');
const REVIEWED: [string, string][] = [['implement', 'pr-open'], ['review', 'reviewed']];
/** `decide` is the person leg — `kind: person`, `asks: owner`, and `expires` reaching `parked`
 *  after a minute. */
const PERSON = {
  ...roadmapPr,
  stations: { ...roadmapPr.stations, parked: { label: 'Parked' } },
  legs: {
    ...roadmapPr.legs,
    merge: { ...roadmapPr.legs.merge, from: ['reviewed', 'adjudicated', 'parked'] },
    decide: { from: ['reviewed'], to: ['adjudicated', 'parked'], kind: 'person', asks: 'owner', expires: { after_s: 60, reached: 'parked' } } as Record<string, unknown>,
  },
};
const QUESTION = { id: 'q-1', severity: 'high', options: [{ id: 'ship', reached: 'adjudicated' }, { id: 'hold', reached: 'parked' }] };
const decision = (local: string, option: string, ref: string) =>
  ({ type: 'std:decision@1', ticket: local, ref, value: { id: 'q-1', leg: 'decide', option, reached: option === 'ship' ? 'adjudicated' : 'parked' } });

let admin: TestKey;
let owner: TestKey;
let git: Git;

const station = (local: string) => rows<{ station: string; next_leg: string | null; next_source: string }>(
  'SELECT station, next_leg, next_source FROM ticket_stations WHERE ticket_id = ?', `docs:${local}`);
const kinds = async (local: string) => (await rows<{ kind: string }>('SELECT kind FROM ticket_history WHERE ticket_id = ? ORDER BY id', `docs:${local}`)).map((r) => r.kind);
const answerRow = (local: string) => rows<{ option: string | null; answered_by: string | null }>('SELECT option, answered_by FROM ticket_questions WHERE ticket_id = ?', `docs:${local}`);
const needsYou = async (local: string) => (await withCore((core) => core.questions.needsYou())).find((x) => x.ticket_id === `docs:${local}`);
const atDecide = (local: string) => git.add(local, { question: QUESTION }, placed('reviewed', REVIEWED, [['decide', 'ready']]));

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  git = new Git();
  git.registry = [course(3, 3, { course: PERSON })];
  expect((await git.post()).status).toBe(200);
  await cutover();
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
});

it('a queued person leg waits unheld: its question is stored and listed, a stray one dropped, and a runner is refused (rule person)', async () => {
  atDecide('P');
  git.add('A', { question: QUESTION }, placed('reviewed', REVIEWED, [['fix', 'ready']]));
  expect((await git.post()).status).toBe(200);
  // Stored with its question and listed under Needs you, with the leg's `asks` and options.
  expect(await needsYou('P')).toMatchObject({ leg: 'decide', asks: 'owner', question_id: 'q-1', options: QUESTION.options });
  expect((await rows('SELECT question_id FROM ticket_questions WHERE ticket_id = ?', 'docs:P'))).toEqual([{ question_id: 'q-1' }]);
  // The stray question — a ticket whose queued leg is an agent's — is dropped and logged.
  expect((await rows('SELECT * FROM ticket_questions WHERE ticket_id = ?', 'docs:A'))).toEqual([]);
  expect((await rows('SELECT 1 FROM events WHERE kind = ? AND ticket_id = ?', 'question-dropped', 'docs:A')).length).toBe(1);
  // A runner asks: refused, rule `person` (G-BTN-90's person clause).
  const w = await register('vm-a', { courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] });
  const asked = await claimItem('vm-a', w.secret, { ticket_id: 'docs:P' });
  expect(asked.status).toBe(409);
  expect(asked.json).toMatchObject({ code: 'not-eligible', rule: 'person', rule_code: 'person' });
});

it('the owner answers in git: the sync attests the answer, the leg arrives from its std:decision@1 as a fact-arrival', async () => {
  atDecide('G');
  expect((await git.post()).status).toBe(200);
  // Under `cooperative` the answer the ticket shows (`answer:` in git) is the sync's attestation;
  // its `ref` is the commit that wrote it (R-BTN-39's idempotence).
  expect((await git.post({ attestations: [decision('G', 'ship', 'f'.padEnd(40, '1'))] })).status).toBe(200);
  expect(await station('G')).toEqual([{ station: 'adjudicated', next_leg: 'merge', next_source: 'baton' }]);
  expect(await kinds('G')).toContain('fact-arrival');
  expect(await answerRow('G')).toEqual([{ option: 'ship', answered_by: 'sync' }]);
  // The same answer attested again on a later run moves nothing.
  expect((await git.post({ attestations: [decision('G', 'ship', 'f'.padEnd(40, '1'))] })).status).toBe(200);
  expect((await kinds('G')).filter((k) => k === 'fact-arrival')).toHaveLength(1);
});

it('the owner answers with baton decision answer: the same arrival through the attestations route', async () => {
  atDecide('C');
  expect((await git.post()).status).toBe(200);
  // The CLI's own planning: `baton decision answer docs:C ship` posts exactly this, signed.
  const p = answerPlan('docs:C', 'ship');
  expect(p).toEqual({ method: 'POST', path: '/v1/repositories/docs/attestations', body: { type: 'std:decision@1', subject: { ticket: 'C' }, value: { option: 'ship' } } });
  const res = await keyCall(owner, p.path, p.body);
  expect(res.status).toBe(200);
  expect(res.json).toMatchObject({ ok: true, reached: 'adjudicated', option: 'ship' });
  expect(await station('C')).toEqual([{ station: 'adjudicated', next_leg: 'merge', next_source: 'baton' }]);
  expect(await answerRow('C')).toEqual([{ option: 'ship', answered_by: `owner:${owner.fingerprint}` }]);
});

it('an answer naming an option the question lacks: invalid-params from the CLI, dropped answer-invalid from the sync', async () => {
  atDecide('I');
  expect((await git.post()).status).toBe(200);
  const cli = await keyCall(owner, '/v1/repositories/docs/attestations',
    { type: 'std:decision@1', subject: { ticket: 'I' }, value: { option: 'neither' } });
  expect(cli.status).toBe(400);
  expect(cli.json).toMatchObject({ code: 'invalid-params' });
  expect((await git.post({ attestations: [decision('I', 'neither', 'f'.padEnd(40, '2'))] })).status).toBe(200);
  expect((await rows('SELECT 1 FROM events WHERE kind = ? AND ticket_id = ?', 'answer-invalid', 'docs:I')).length).toBe(1);
  expect(await station('I')).toEqual([{ station: 'reviewed', next_leg: 'decide', next_source: 'marker' }]);
});

it('a person leg with expires: unanswered it arrives at reached with question-expired; answered after the instant, arrival-unapplied', async () => {
  atDecide('E');
  expect((await git.post()).status).toBe(200);
  expect((await rows<{ person_expires_at: number }>('SELECT person_expires_at FROM ticket_stations WHERE ticket_id = ?', 'docs:E'))).toEqual([{ person_expires_at: T0 + 60_000 }]);
  await setClock(T0 + 61_000);
  await tick();
  expect(await station('E')).toEqual([{ station: 'parked', next_leg: 'merge', next_source: 'baton' }]);
  expect(await kinds('E')).toContain('question-expired');
  // The late answer — attested after the expiry applied — is unapplied (R-BTN-39).
  expect((await git.post({ attestations: [decision('E', 'ship', 'f'.padEnd(40, '3'))] })).status).toBe(200);
  expect(await kinds('E')).toContain('arrival-unapplied');
  expect(await station('E')).toEqual([{ station: 'parked', next_leg: 'merge', next_source: 'baton' }]);
});
