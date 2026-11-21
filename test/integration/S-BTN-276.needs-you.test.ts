// S-BTN-276 what waits on a person, per repository (B-195, B-219; BATON_SPEC §7.3 R-BTN-163,
// §6.4 R-BTN-116, §12.8 R-BTN-185, R-BTN-191): `GET /v1/repositories/{repository}/needs-you`
// (`repo.needs-you`) answers, in one read, the repository's open conditions, its queued person
// legs with whether the caller may answer, and V1's listings that are not conditions yet.
// Must hold:
//   1. the open conditions come severity first (critical, high, the rest), then by age; a
//      closed one is not among them; each carries its `resolve_url` and an empty `allowed`;
//   2. a queued person leg is listed with its question and options; `answerable` is true for an
//      owner key of the repository under a policy whose `inputs.answers` admits it, false
//      under `attestation`, and false — with the reason — for an administrator's session, an
//      administrator's key and a granted runner key;
//   3. the listings are the repository's own: a held ticket of `docs` is in `docs`' answer and
//      not in `ops`'; `adoptions` is an administrator's alone; the instance-wide listings are
//      named under `elsewhere`, not served;
//   4. the whole state (`GET /v1/admin/state`, `stateView()`) is unchanged by it: the same
//      sections as before.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { COOPERATIVE } from '../../src/core/policy';
import { keyCall, setClock } from '../helpers';
import { atDecide, fixture, MIN, postSession, raise, readAs, readSession, running, T0, type Fixture, type Json } from '../lib/needsYouFixture';

let f: Fixture;

beforeEach(async () => {
  f = await fixture();
});

describe('S-BTN-276 what waits on a person (B-195, B-219)', () => {
  it('open conditions come by severity, then age', async () => {
    const run = await running();
    const normal = await raise(run, { type: 'ask.owner' });
    await setClock(T0 + MIN);
    const high = await raise(run, { type: 'ask.owner', severity: 'high' });
    await setClock(T0 + 2 * MIN);
    const critical = await raise(run, { type: 'hitl', severity: 'critical', restarts: { retry: 'again' } });
    await setClock(T0 + 3 * MIN);
    const high2 = await raise(run, { type: 'interact', severity: 'high' });
    // A `warning` is recorded as it is raised: closed, and not on the list.
    await raise(run, { type: 'warning' });
    const res = await readSession(f.cookie, '/v1/repositories/docs/needs-you');
    expect(res.status).toBe(200);
    expect(res.json.conditions.map((c: Json) => c.condition_id)).toEqual([critical, high, high2, normal]);
    expect(res.json.conditions[2]).toMatchObject({ type: 'interact', ticket_id: 'docs:A', leg: 'implement', resolve_url: `/repositories/docs/conditions/${high2}`, allowed: [], outcome: 'open' });
    expect(res.json.conditions[2].url).toMatch(/^https:\/\/claude\.ai\//);
    expect(res.json.conditions[0].restarts).toEqual({ retry: 'again' });
    expect(res.json).toMatchObject({ repository: 'docs', server_time: T0 + 3 * MIN, questions: [], held_posts: 0 });
    expect(res.json.not_built).toMatchObject({ resolve: 'B-56', listings_as_conditions: 'B-57', session_answer: 'B-76' });
    // Another repository holds none of them.
    expect((await readSession(f.cookie, '/v1/repositories/ops/needs-you')).json.conditions).toEqual([]);
  });

  it('a queued person leg says who may answer it: an owner key where the policy admits one, never a session or an administrator', async () => {
    atDecide(f.git, 'P');
    expect((await f.git.post()).status).toBe(200);
    const question = { ticket_id: 'docs:P', leg: 'decide', asks: 'owner', question_id: 'q-1', severity: 'high' };
    const session = await readSession(f.cookie, '/v1/repositories/docs/needs-you');
    expect(session.json.questions).toEqual([expect.objectContaining({ ...question, answerable: false, human_only: false })]);
    expect(session.json.questions[0].options.map((o: Json) => [o.id, o.reached])).toEqual([['ship', 'adjudicated'], ['hold', 'parked']]);
    expect(session.json.questions[0].why).toMatch(/administrator/);
    const owner = await readAs(f.owner, '/v1/repositories/docs/needs-you');
    expect(owner.json.questions).toEqual([expect.objectContaining({ ...question, answerable: true, why: null })]);
    for (const key of [f.admin, f.reader]) {
      const res = await readAs(key, '/v1/repositories/docs/needs-you');
      expect([res.status, res.json.questions[0].answerable, typeof res.json.questions[0].why]).toEqual([200, false, 'string']);
    }
    // The word is the write's own rule: the owner key's answer is accepted…
    // …and under `inputs.answers: attestation` an owner key's no longer counts, and the read says so.
    const policy = { ...COOPERATIVE, inputs: { ...COOPERATIVE.inputs, answers: 'attestation' } };
    const put = await keyCall(f.owner, '/v1/owner/docs/policy', { base_version: 1, policy }, 'PUT');
    expect([put.status, put.json.code]).toEqual([200, undefined]);
    const strict = await readAs(f.owner, '/v1/repositories/docs/needs-you');
    expect(strict.json.questions[0]).toMatchObject({ answerable: false, human_only: true });
    const refused = await keyCall(f.owner, '/v1/repositories/docs/attestations', { type: 'std:decision@1', subject: { ticket: 'P' }, value: { option: 'ship' } });
    expect([refused.status, refused.json.code]).toEqual([403, 'forbidden']);
    expect((await readSession(f.cookie, '/v1/repositories/docs/needs-you')).json.questions[0]).toMatchObject({ answerable: false, human_only: true });
  });

  it('the listings are the repository’s own; adoptions an administrator’s; the instance’s are named, not served', async () => {
    // A hold on a ticket of docs: one of V1's Needs-you listings (`held_items`).
    expect((await postSession(f.cookie, '/v1/ui/overrides/docs:A', { hold: true })).status).toBe(200);
    const docs = await readSession(f.cookie, '/v1/repositories/docs/needs-you');
    expect(docs.json.listings.held_items).toEqual([expect.objectContaining({ ticket_id: 'docs:A' })]);
    expect(Object.keys(docs.json.listings).sort()).toEqual(['adoptions', 'bars_mismatch', 'blocked_capability', 'course_changed', 'courses_refused', 'fence_pending', 'forge_secret_missing', 'held_items',
      'mirror_late', 'no_owner_channel', 'policy', 'pool_unclaimed', 'regressed', 'scope', 'stale_skills', 'sync_late', 'unacknowledged_releases', 'unconfirmed', 'unsigned_control']);
    expect(docs.json.elsewhere).toEqual(['instances_unknown', 'keys', 'capacity', 'stale_clients', 'stale_skills_no_course']);
    const ops = await readSession(f.cookie, '/v1/repositories/ops/needs-you');
    expect(ops.json.listings.held_items).toEqual([]);
    // An owner key and a granted key read the listings without the adoptions.
    for (const key of [f.owner, f.reader]) {
      const res = await readAs(key, '/v1/repositories/docs/needs-you');
      expect([res.status, 'adoptions' in res.json.listings, res.json.listings.held_items.length]).toEqual([200, false, 1]);
    }
    expect((await readAs(f.opsOwner, '/v1/repositories/docs/needs-you')).json.code).toBe('forbidden');
    // The whole state keeps its sections: nothing was moved out of it.
    const state = await readAs(f.admin, '/v1/admin/state');
    expect(state.json.needs_you.held_items).toEqual([expect.objectContaining({ ticket_id: 'docs:A' })]);
    expect(Object.keys(state.json.needs_you)).toEqual(expect.arrayContaining(['conditions', 'questions', 'adoptions', 'keys', 'stale_clients', 'scope', 'unsigned_control']));
  });
});
