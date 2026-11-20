// S-BTN-280 the mirror's view of a repository (B-201; BATON_SPEC §4.3 R-BTN-11, R-BTN-62, §4.7
// R-BTN-85, §16.1 R-BTN-28, §14): `GET /v1/repositories/{repository}/sync` (`repo.sync`).
// Must hold:
//   1. `head` is the head snapshot with its parent, count, observation and source declaration;
//      `mode` the repository's (`shadow` with no `cutover_at`, `cut-over` with it);
//   2. `observation.outstanding` carries a handed-out number with its age, `void` past ten
//      minutes, and is null once the number is posted;
//   3. a `force` post is refused and held: `held` lists it with its auto-accept time,
//      `last_post` says the sync's last post was not accepted (`snapshot-rejected`), and the
//      head stands;
//   4. `discrepancies` are the repository's own inside `?since=` (7 days by default, 30 at
//      most), newest first, each `{sub, baton, git, observation}` with its ticket, and counted
//      by kind; a `since` in the future or over 30 days back is `invalid-params`;
//   5. `adoptions` is served to an administrator — session or key — and absent for an owner key
//      and a granted key; `allowed` names the controls an administrator's session may use on
//      the repository as it stands, and is empty for a key;
//   6. another repository's read shows none of it; a repository not the caller's is `forbidden`.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { rows, setClock, syncCall, withCore } from '../helpers';
import { fixture, MIN, readAs, readSession, T0, type Fixture, type Json } from '../lib/needsYouFixture';

let f: Fixture;
const PATH = '/v1/repositories/docs/sync';
const DAY = 86_400_000;
const HOUR = 3_600_000;

beforeEach(async () => {
  f = await fixture();
});

describe('S-BTN-280 the mirror’s view of a repository (B-201)', () => {
  it('the head, the mode, the observation counter and an outstanding number', async () => {
    const res = await readSession(f.cookie, PATH);
    expect(res.status).toBe(200);
    expect(res.json.head).toEqual({ sha: f.git.head, parent_sha: null, received_at: T0, ticket_count: 1, observation: expect.any(Number), source: null });
    expect(res.json.mode).toEqual({ mode: 'cut-over', cutover_at: T0 });
    expect(res.json.observation).toEqual({ last: res.json.head.observation, last_handed_out: res.json.head.observation, outstanding: null });
    expect(res.json.last_post).toEqual({ at: T0, sha: f.git.head, accepted: true });
    expect(res.json.dispatch).toMatchObject({ sync_workflow: expect.any(String), last_resync_request_at: null, last_refusal: null });
    expect(res.json.not_built).toMatchObject({ wants: 'R-BTN-94', force_resync: 'R-BTN-11' });
    // A sync takes a number and has not posted: it is outstanding, with its age.
    const taken = (await (await syncCall('/v1/sync/observation', {})).json()) as { observation: number };
    await setClock(T0 + 3 * MIN);
    const out = (await readSession(f.cookie, PATH)).json.observation;
    expect(out).toEqual({ last: res.json.head.observation, last_handed_out: taken.observation, outstanding: { number: taken.observation, handed_out_at: T0, age_s: 180, void: false } });
    await setClock(T0 + 11 * MIN);
    expect((await readSession(f.cookie, PATH)).json.observation.outstanding).toMatchObject({ age_s: 660, void: true });
    // ops has never posted, and has not cut over.
    const ops = (await readSession(f.cookie, '/v1/repositories/ops/sync')).json;
    expect([ops.head, ops.mode, ops.last_post, ops.held]).toEqual([null, { mode: 'shadow', cutover_at: null }, null, []]);
  });

  it('a force post is held: it is listed with its auto-accept time and the last post reads refused', async () => {
    await setClock(T0 + MIN);
    const forced = (await f.git.post({ force: true })) as Json;
    expect([forced.status, forced.code]).toEqual([409, 'snapshot-rejected']);
    const res = (await readSession(f.cookie, PATH)).json;
    expect(res.held).toEqual([{ sha: '2'.padStart(40, '0'), parent_sha: f.git.head, head_sha: f.git.head, ticket_count: 1, received_at: T0 + MIN, auto_accept_at: T0 + MIN + DAY, accepted_at: null }]);
    expect(res.last_post).toEqual({ at: T0 + MIN, sha: '2'.padStart(40, '0'), accepted: false, code: 'snapshot-rejected' });
    expect(res.head.sha).toBe(f.git.head);
    expect(res.allowed).toEqual(['repo.resync', 'repo.accept-post']);
    expect((await readAs(f.owner, PATH)).json.allowed).toEqual([]);
  });

  it('the discrepancies of the window, the repository’s own, by kind', async () => {
    await withCore((c) => c.store.transaction(() => {
      c.history.discrepancy('docs:A', 'regressed', { station: 'pr-open' }, { station: 'filed' }, 7);
      c.history.discrepancy('ops:Z', 'off-graph', { station: 'x' }, { station: 'y' }, 3);
    }));
    // (A session lives 12 hours: the clock moves inside it.)
    await setClock(T0 + 2 * HOUR);
    await withCore((c) => c.store.transaction(() => c.history.discrepancy('docs:A', 'foreign-write', { holder: 'vm-a' }, { author: 'someone' }, 9)));
    const whole = await readSession(f.cookie, PATH);
    expect([whole.status, whole.json.code, whole.json.message]).toEqual([200, undefined, undefined]);
    const res = whole.json.discrepancies;
    expect(res.since).toBe(T0 + 2 * HOUR - 7 * DAY);
    expect(res.by_kind).toEqual({ 'foreign-write': 1, regressed: 1 });
    expect(res.truncated).toBe(false);
    expect((res.rows as Json[]).map(({ id: _id, ...r }) => r)).toEqual([
      { ticket_id: 'docs:A', claim_id: null, at: T0 + 2 * HOUR, sub: 'foreign-write', baton: { holder: 'vm-a' }, git: { author: 'someone' }, observation: 9 },
      { ticket_id: 'docs:A', claim_id: null, at: T0, sub: 'regressed', baton: { station: 'pr-open' }, git: { station: 'filed' }, observation: 7 },
    ]);
    // A narrower window leaves the older one out.
    const narrow = (await readSession(f.cookie, `${PATH}?since=${encodeURIComponent(new Date(T0 + HOUR).toISOString())}`)).json.discrepancies;
    expect([narrow.since, (narrow.rows as Json[]).map((r) => r.sub), narrow.by_kind]).toEqual([T0 + HOUR, ['foreign-write'], { 'foreign-write': 1 }]);
    // Thirty days back is the most; the future, and anything that is no ISO time, is refused.
    expect((await readSession(f.cookie, `${PATH}?since=${encodeURIComponent(new Date(T0 + 2 * HOUR - 30 * DAY).toISOString())}`)).status).toBe(200);
    for (const bad of [new Date(T0 + 3 * HOUR).toISOString(), new Date(T0 - 40 * DAY).toISOString(), 'yesterday', '7']) {
      const refused = await readSession(f.cookie, `${PATH}?since=${encodeURIComponent(bad)}`);
      expect([bad, refused.status, refused.json.code]).toEqual([bad, 400, 'invalid-params']);
    }
    expect((await readSession(f.cookie, `${PATH}?days=7`)).json.code).toBe('invalid-params');
  });

  it('adoptions are an administrator’s; allowed is the administrator’s session’s; a stranger’s repository is forbidden', async () => {
    await rows(`UPDATE repositories SET cutover_at = NULL WHERE id = 'docs'`);
    const session = (await readSession(f.cookie, PATH)).json;
    expect(session.adoptions).toEqual([]);
    expect(session.mode).toEqual({ mode: 'shadow', cutover_at: null });
    expect(session.allowed).toEqual(['repo.resync', 'repo.cutover']);
    const admin = (await readAs(f.admin, PATH)).json;
    expect([admin.adoptions, admin.allowed]).toEqual([[], []]);
    for (const key of [f.owner, f.reader]) {
      const res = await readAs(key, PATH);
      expect([res.status, 'adoptions' in res.json, res.json.allowed]).toEqual([200, false, []]);
    }
    expect((await readAs(f.opsOwner, PATH)).json.code).toBe('forbidden');
    expect((await readSession(f.cookie, '/v1/repositories/nowhere/sync')).json.code).toBe('forbidden');
  });
});
