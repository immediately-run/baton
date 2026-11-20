// S-BTN-275 one condition (B-195; BATON_SPEC §7.1 R-BTN-160, §7.3 R-BTN-163, §14):
// `GET /v1/repositories/{repository}/conditions/{condition}` (`condition.show`) answers the
// condition as the list returns it, with its outcome, its Resolve path in the tree, the ticket's
// position and the tickets blocked on its ticket. Must hold:
//   1. an administrator's session, an owner key and a granted key read the same condition: its
//      type, disposition, severity, restarts, default, `resolve_url`, the ticket's station;
//   2. `allowed` is empty for every caller and `not_built` names B-56 — no resolve exists, so
//      none is offered;
//   3. `unblocks` lists the tickets with a block on the condition's ticket while it is open;
//   4. another repository's id, an unknown id and a malformed id are `not-found`, the same;
//      a repository the caller cannot read is the one `forbidden`;
//   5. the conditions list keeps its order, page and cursor (B-234) and each entry gains
//      `outcome`, `closed_at` and `resolve_url`.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { endClaim, rows } from '../helpers';
import { fixture, raise, readAs, readSession, running, type Fixture } from '../lib/needsYouFixture';

let f: Fixture;

beforeEach(async () => {
  f = await fixture();
});

describe('S-BTN-275 one condition (B-195)', () => {
  it('a session, an owner key and a granted key read one condition, with nothing to resolve it by', async () => {
    f.git.add('B', { blocked_by: ['A'] });
    expect((await f.git.post()).status).toBe(200);
    const run = await running();
    const id = await raise(run, { type: 'ask.owner', severity: 'critical', restarts: { retry: 'run it again', park: 'hold it' }, default: 'retry' });
    const path = `/v1/repositories/docs/conditions/${id}`;
    const session = await readSession(f.cookie, path);
    expect(session.status).toBe(200);
    expect(session.json).toMatchObject({
      condition_id: id, repository: 'docs', ticket_id: 'docs:A', leg: 'implement', run_id: run.runId, claim_id: run.claimId,
      type: 'ask.owner', disposition: 'suspend', severity: 'critical', url: null,
      restarts: { retry: 'run it again', park: 'hold it' }, default: 'retry',
      outcome: 'open', closed_at: null, resolve_url: `/repositories/docs/conditions/${id}`,
      allowed: [], not_built: { resolve: 'B-56', detail: 'B-55', handler: 'R-BTN-161' },
    });
    expect(session.json.ticket).toMatchObject({ ticket_id: 'docs:A', course_id: 'roadmap-pr', station: 'filed' });
    // R-BTN-33: no body, note or leg text — the fields above are all there is.
    expect(Object.keys(session.json).sort()).toEqual(['allowed', 'claim_id', 'closed_at', 'closed_how', 'condition_id', 'default', 'disposition', 'leg', 'not_built',
      'outcome', 'raised_at', 'repository', 'resolve_url', 'restarts', 'run_id', 'severity', 'ticket', 'ticket_id', 'type', 'unblocks', 'url']);
    // The tickets blocked on its ticket, from `ticket_blocks`.
    const blocked = (await rows<{ ticket_id: string }>(`SELECT ticket_id FROM ticket_blocks WHERE kind = 'ticket'`)).map((r) => r.ticket_id);
    expect(session.json.unblocks).toEqual(blocked);
    expect(blocked).toEqual(['docs:B']);
    // The keys read the same condition; none is offered a resolve.
    for (const key of [f.owner, f.reader, f.admin]) {
      const res = await readAs(key, path);
      expect([res.status, res.json.condition_id, res.json.allowed]).toEqual([200, id, []]);
      expect(res.etag).toMatch(/^"/);
    }
  });

  it('an id of another repository, an unknown id and a malformed id are not-found; a repository that is not the caller’s is forbidden', async () => {
    const run = await running();
    const id = await raise(run, { type: 'ask.owner' });
    for (const path of [`/v1/repositories/ops/conditions/${id}`, '/v1/repositories/docs/conditions/9999', '/v1/repositories/docs/conditions/nope', '/v1/repositories/docs/conditions/0']) {
      const res = await readSession(f.cookie, path);
      expect([path, res.status, res.json.code]).toEqual([path, 404, 'not-found']);
    }
    // The owner of another repository, and a repository that does not exist: the one refusal.
    expect((await readAs(f.opsOwner, `/v1/repositories/docs/conditions/${id}`)).json.code).toBe('forbidden');
    expect((await readSession(f.cookie, `/v1/repositories/nowhere/conditions/${id}`)).json.code).toBe('forbidden');
    // An unknown query parameter is refused.
    expect((await readSession(f.cookie, `/v1/repositories/docs/conditions/${id}?x=1`)).json.code).toBe('invalid-params');
  });

  it('a closed condition says how it closed; the list keeps its order and gains outcome, closed_at and resolve_url', async () => {
    const run = await running();
    const interact = await raise(run, { type: 'interact' });
    const ask = await raise(run, { type: 'ask.owner', severity: 'high' });
    const before = await readAs(f.reader, '/v1/repositories/docs/conditions?open=1');
    expect(before.json.conditions.map((c: { condition_id: number }) => c.condition_id)).toEqual([interact, ask]);
    expect(before.json.conditions[0]).toMatchObject({ type: 'interact', outcome: 'open', closed_at: null, resolve_url: `/repositories/docs/conditions/${interact}` });
    expect(before.json.cursor).toBeNull();
    // The run ends: its open `interact` closes with it (R-BTN-195); the `suspend` stays.
    expect((await endClaim(run.cred, run.secret, run.claimId, { end_reason: 'released:leg-timeout', reached: 'filed', next: 'implement' })).status).toBe(200);
    const shown = await readSession(f.cookie, `/v1/repositories/docs/conditions/${interact}`);
    expect(shown.json).toMatchObject({ outcome: 'closed', closed_how: 'run-ended', unblocks: [] });
    expect(typeof shown.json.closed_at).toBe('number');
    const all = await readSession(f.cookie, '/v1/repositories/docs/conditions');
    expect(all.json.conditions.map((c: { condition_id: number; outcome: string }) => [c.condition_id, c.outcome])).toEqual([[interact, 'closed'], [ask, 'open']]);
    const open = await readSession(f.cookie, '/v1/repositories/docs/conditions?open=1');
    expect(open.json.conditions.map((c: { condition_id: number }) => c.condition_id)).toEqual([ask]);
  });
});
