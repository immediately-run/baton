// person-legs.test.ts — B-7 (BATON_SPEC §6.4 R-BTN-116): the leg a person answers. The course
// file marks it `kind: "person"` with `asks`; no runner is offered it or may claim or advance
// into it (rule `person`, G-BTN-90's person clause); the ticket waits in that leg's queue. The
// ticket source posts the queued person leg's question with the ticket (§4.4) — stored in
// `ticket_questions`, a stray one dropped and logged. The answer is a `std:decision@1`: the
// sync's, attested from the ticket's `answer:` where the policy's `inputs.answers` admits git,
// or an owner's through `POST /v1/repositories/{repository}/attestations` (`baton decision
// answer`). Either is applied as the leg's arrival (R-BTN-39): the ticket moves to the outcome
// the option names, `next_source: baton`, and a snapshot that has not caught up does not undo
// it. An invalid answer is refused `invalid-params` from the owner's route and dropped and
// logged `answer-invalid` from the sync. A leg with `expires` arrives at its `reached` when the
// instant passes unanswered (`question-expired`), and a later answer is `arrival-unapplied`.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, course, cutover, keyCall, makeApiKey, placed, rows, setClock, tick, withCore, claimItem, register, recommended, setAdminKeys, apiKeyCall } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { Questions } from '../../src/core/questions';

const T0 = Date.parse('2026-11-04T12:00:00Z');
const REVIEWED: [string, string][] = [['implement', 'pr-open'], ['review', 'reviewed']];

/** The course file with a person leg `decide` leaving `reviewed`, reaching `adjudicated` or the
 *  `parked` the course adds; `expires` names `parked` at 60 s. */
const withPerson = (expires = false) => ({
  ...roadmapPr,
  stations: { ...roadmapPr.stations, parked: { label: 'Parked' } },
  legs: {
    ...roadmapPr.legs,
    merge: { ...roadmapPr.legs.merge, from: ['reviewed', 'adjudicated', 'parked'] },
    decide: { from: ['reviewed'], to: ['adjudicated', 'parked'], kind: 'person', asks: 'owner', ...(expires ? { expires: { after_s: 60, reached: 'parked' } } : {}) } as Record<string, unknown>,
  },
});
const QUESTION = { id: 'decide-q', url: 'https://github.com/immediately-run/docs/content/roadmap/Q.mdx', severity: 'high',
  options: [{ id: 'a', reached: 'adjudicated' }, { id: 'b', reached: 'parked' }] };
const DECISION = (option: string, over: Record<string, unknown> = {}) =>
  ({ type: 'std:decision@1', ticket: 'Q', ref: 'c0ffee'.padEnd(40, '0'), value: { id: 'decide-q', leg: 'decide', option, reached: option === 'a' ? 'adjudicated' : 'parked', ...over } });

let admin: TestKey;
let owner: TestKey;
let git: Git;
const station = (local: string) => rows<{ station: string; path: string; next_leg: string | null; next_source: string; person_expires_at: number | null }>(
  'SELECT station, path, next_leg, next_source, person_expires_at FROM ticket_stations WHERE ticket_id = ?', `docs:${local}`);
const question = () => rows<{ question_id: string | null; leg: string; url: string | null; option: string | null; answered_at: number | null; answered_by: string | null; answered_ref: string | null }>(
  'SELECT question_id, leg, url, option, answered_at, answered_by, answered_ref FROM ticket_questions WHERE ticket_id = ?', 'docs:Q');
const events = (kind: string) => rows<{ detail_json: string }>('SELECT detail_json FROM events WHERE kind = ? ORDER BY seq', kind);
const history = (kind: string) => rows<{ leg: string | null; reached: string | null; next_leg: string | null; detail_json: string | null }>(
  'SELECT leg, reached, next_leg, detail_json FROM ticket_history WHERE ticket_id = ? AND kind = ? ORDER BY id', 'docs:Q', kind);

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  git = new Git();
  git.registry = [course(3, 3, { course: withPerson() })];
  git.add('Q', { question: QUESTION }, placed('reviewed', REVIEWED, [['decide', 'ready']]));
  git.add('R', {}, placed('reviewed', REVIEWED, [['fix', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover();
  // The repository's owner key, for the answer route.
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
});

describe('R-BTN-116: a person leg waits unheld', () => {
  it('is queued, never recommended, and refused to a runner at a claim (rule person)', async () => {
    expect(await station('Q')).toEqual([{ station: 'reviewed', path: JSON.stringify(REVIEWED.map(([leg, reached]) => ({ leg, reached }))), next_leg: 'decide', next_source: 'marker', person_expires_at: null }]);
    const w = await register('vm-a', { courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] });
    // R stays recommended — the query skips the person leg alone, not the ticket's station.
    expect(await recommended(w.id)).toEqual(['docs:R']);
    const refused = await claimItem('vm-a', w.secret, { ticket_id: 'docs:Q' });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: 'not-eligible', rule: 'person', rule_code: 'person' });
  });
});

describe('R-BTN-116: the question a snapshot posts', () => {
  it('is stored with its options and listed under Needs you; the same id again is silent', async () => {
    expect(await question()).toEqual([expect.objectContaining({ question_id: 'decide-q', leg: 'decide', url: QUESTION.url, answered_at: null })]);
    expect(await history('question-posted')).toHaveLength(1);
    expect((await withCore((core) => core.questions.needsYou())).find((x) => x.ticket_id === 'docs:Q')).toMatchObject(
      { leg: 'decide', asks: 'owner', question_id: 'decide-q', severity: 'high', options: QUESTION.options });
    expect((await git.refresh()).status).toBe(200);
    expect(await history('question-posted')).toHaveLength(1);
  });

  it('a question whose queued leg is an agent\'s is dropped and logged question-dropped', async () => {
    git.add('R', { question: QUESTION }, placed('reviewed', REVIEWED, [['fix', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect(await rows('SELECT * FROM ticket_questions WHERE ticket_id = ?', 'docs:R')).toEqual([]);
    expect(await events('question-dropped')).toHaveLength(1);
  });

  it('an option naming an outcome the leg does not offer is dropped', async () => {
    git.tickets.delete('Q');
    delete (git.stations as Record<string, unknown>).Q;
    git.add('Q2', { question: { id: 'q2', options: [{ id: 'x', reached: 'filed' }] } }, placed('reviewed', REVIEWED, [['decide', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect(await rows('SELECT * FROM ticket_questions WHERE ticket_id = ?', 'docs:Q2')).toEqual([]);
    expect(await events('question-dropped')).toHaveLength(1);
  });
});

describe('R-BTN-116, R-BTN-39: the answer', () => {
  it('the sync\'s attestation is applied as the leg\'s arrival, and re-attesting the same ref is silent', async () => {
    expect((await git.post({ attestations: [DECISION('a')] })).status).toBe(200);
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'adjudicated', next_leg: 'merge', next_source: 'baton' })]);
    expect(JSON.parse((await station('Q'))[0].path).at(-1)).toEqual({ leg: 'decide', reached: 'adjudicated' });
    expect(await question()).toEqual([expect.objectContaining({ option: 'a', answered_by: 'sync', answered_ref: 'c0ffee'.padEnd(40, '0') })]);
    expect(await history('fact-arrival')).toEqual([expect.objectContaining({ leg: 'decide', reached: 'adjudicated', next_leg: 'merge' })]);
    expect(await history('question-answered')).toHaveLength(1);
    // The same answer attested again (the sync re-posts every quarter hour) moves nothing.
    expect((await git.refresh({ attestations: [DECISION('a')] })).status).toBe(200);
    expect(await history('fact-arrival')).toHaveLength(1);
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'adjudicated' })]);
  });

  it('a snapshot that has not caught up does not undo the arrival; one that extends takes over', async () => {
    expect((await git.post({ attestations: [DECISION('a')] })).status).toBe(200);
    // A refresh still placing Q at `reviewed`, the answer left out: Baton's position stands.
    expect((await git.refresh()).status).toBe(200);
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'adjudicated', next_source: 'baton' })]);
    // The station function catches up — the path extends Baton's — and the snapshot owns it again.
    git.place('Q', placed('adjudicated', [...REVIEWED, ['decide', 'adjudicated']], [['merge', 'waiting', 'ci']]));
    expect((await git.post()).status).toBe(200);
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'adjudicated', next_leg: 'merge', next_source: 'marker' })]);
  });

  it('an answer naming an option the question lacks: the sync\'s is dropped answer-invalid, the owner\'s refused invalid-params', async () => {
    expect((await git.post({ attestations: [DECISION('zed')] })).status).toBe(200);
    expect(await events('answer-invalid')).toHaveLength(1);
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'reviewed', next_leg: 'decide' })]);
    const refused = await keyCall(owner, '/v1/repositories/docs/attestations',
      { type: 'std:decision@1', subject: { ticket: 'Q' }, value: { option: 'zed' } });
    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({ code: 'invalid-params' });
  });

  it('an owner answers through the attestations route, the option alone naming the question', async () => {
    const res = await keyCall(owner, '/v1/repositories/docs/attestations',
      { type: 'std:decision@1', subject: { ticket: 'docs:Q' }, value: { option: 'b' } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, reached: 'parked', option: 'b' });
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'parked', next_leg: 'merge', next_source: 'baton' })]);
    expect(await question()).toEqual([expect.objectContaining({ option: 'b', answered_by: expect.stringMatching(/^owner:/) })]);
    // A second answer is refused, naming the one that counted.
    const again = await keyCall(owner, '/v1/repositories/docs/attestations',
      { type: 'std:decision@1', subject: { ticket: 'Q' }, value: { option: 'a' } });
    expect(again.status).toBe(400);
    expect(again.json).toMatchObject({ code: 'invalid-params' });
  });

  it('an owner key of another repository, a worker\'s and an administrator\'s may not answer', async () => {
    const stranger = await makeKey('ssh-ed25519', 'stranger-owner');
    const apiKey = await makeApiKey('a person');
    // An administrator's key is never an owner's (R-BTN-57); a key Baton does not know is no
    // principal at all; an API key no listed key holds is the same (R-BTN-159).
    expect((await keyCall(admin, '/v1/repositories/docs/attestations', { type: 'std:decision@1', subject: { ticket: 'Q' }, value: { option: 'a' } })).json).toMatchObject({ code: 'forbidden' });
    expect((await apiKeyCall(apiKey.key, '/v1/repositories/docs/attestations', { type: 'std:decision@1', subject: { ticket: 'Q' }, value: { option: 'a' } })).status).toBe(401);
    expect((await keyCall(stranger, '/v1/repositories/docs/attestations', { type: 'std:decision@1', subject: { ticket: 'Q' }, value: { option: 'a' } })).json).toMatchObject({ code: 'unauthenticated' });
  });

  it('where the policy admits no answer in git, the sync\'s is recorded arrival-unapplied (R-BTN-191)', async () => {
    await withCore((core) => {
      core.store.transaction(() => {
        // The same store and graph, one knob swapped: `inputs.answers: attestation`, under which
        // an answer read from git does not count.
        const strict = new Questions({ store: core.store, now: core.now, graph: (repo, course_) => core.stations.graph(repo, course_),
          answersFrom: () => 'attestation' });
        strict.attestations('docs', [DECISION('a')]);
      });
    });
    expect(await events('arrival-unapplied')).toHaveLength(1);
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'reviewed', next_leg: 'decide' })]);
  });
});

describe('R-BTN-116: expiry', () => {
  beforeEach(async () => {
    git.registry = [course(4, 3, { course: withPerson(true) })];
    expect((await git.post()).status).toBe(200);
  });

  it('the instant is set when the person leg becomes the queued leg, and a re-post restarts nothing', async () => {
    expect(await station('Q')).toEqual([expect.objectContaining({ person_expires_at: T0 + 60_000 })]);
    await setClock(T0 + 30_000);
    expect((await git.refresh()).status).toBe(200);
    expect(await station('Q')).toEqual([expect.objectContaining({ person_expires_at: T0 + 60_000 })]);
  });

  it('unanswered at the instant, the leg arrives at expires.reached with question-expired; a late answer is arrival-unapplied', async () => {
    await setClock(T0 + 61_000);
    await tick();
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'parked', next_leg: 'merge', next_source: 'baton', person_expires_at: null })]);
    expect(await history('question-expired')).toEqual([expect.objectContaining({ leg: 'decide', reached: 'parked' })]);
    expect(await question()).toEqual([expect.objectContaining({ option: null, answered_at: T0 + 61_000, answered_by: 'baton' })]);
    expect((await git.post({ attestations: [DECISION('a')] })).status).toBe(200);
    expect(await events('arrival-unapplied')).toHaveLength(1);
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'parked' })]);
  });

  it('answered before the instant, nothing expires', async () => {
    expect((await git.post({ attestations: [DECISION('b')] })).status).toBe(200);
    await setClock(T0 + 61_000);
    await tick();
    expect(await history('question-expired')).toEqual([]);
    expect(await station('Q')).toEqual([expect.objectContaining({ station: 'parked', next_source: 'baton' })]);
  });
});
