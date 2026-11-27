// S-BTN-262 the completion's confirm and release (B-222; BATON_SPEC §9.6 R-BTN-10, §11.4, §12.2,
// §14): `POST /v1/ui/claims/{claim}/confirm` and `…/release` are an administrator's session's
// two routes over the one function V1's `…/resolve` called. Must hold:
//   1. `confirm` confirms an unconfirmed completion — `confirmed_at` set, a `confirmed` event —
//      and the ticket is no longer `unconfirmed`;
//   2. `release` releases one — the claim `released:requested`, a `released` event — and the
//      ticket is offered again;
//   3. each names its own confirmation (`confirm: true`), answers `not-found` for a claim that
//      is no unconfirmed completion, and needs a session: no cookie is `unauthenticated`;
//   4. both are registry entries placed on the ticket's page, with `claim.fence-clear`.
// The ticket's `202 {confirm_code}` (R-BTN-155) and an owner's session's `forbidden` wait on
// B-76: no confirmation code and no owner session exist, so the routes act at once for the
// only session there is, as `claim.force-reap` does. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, claimRow, cutover, Git, ORIGIN, register, rows, sessionCall, setAdminKeys, setClock, seedClaim } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');

type Row = Record<string, any>;
let admin: TestKey;
let cookie: string;
let runner: number;

const post = async (path: string, body: unknown) => {
  const res = await sessionCall(cookie, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Row };
};
const stateOf = async (local: string) => ((await (await sessionCall(cookie, `/v1/repositories/docs/tickets/${local}`)).json()) as Row);
/** An unconfirmed completion on `local`, seeded as a runner's `done` end leaves it. */
async function completion(local: string): Promise<number> {
  await seedClaim({
    ticket_id: `docs:${local}`, runner_id: runner, request_id: `seed:${local}`, nonce: 'abc123', snapshot_sha: '',
    claimed_at: T0 - 60_000, status: 'completed', ended_at: T0, end_reason: 'done', ended_at_sha: 'c'.repeat(40),
  });
  return (await rows<{ id: number }>(`SELECT id FROM claims WHERE ticket_id = ? AND status = 'completed'`, `docs:${local}`))[0].id;
}
const events = async (claim: number) => (await rows<{ kind: string; actor: string }>('SELECT kind, actor FROM events WHERE claim_id = ? ORDER BY seq', claim));

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
  expect((await new Git().add('T-1').add('T-2').post()).status).toBe(200);
  await cutover(T0);
  cookie = await adminSession(admin);
  runner = (await register('vm-a')).id;
});

describe('S-BTN-262 the completion’s confirm and release (B-222)', () => {
  it('confirm confirms an unconfirmed completion', async () => {
    const claim = await completion('T-1');
    const before = await stateOf('T-1');
    expect([before.state, before.detail.claim_id]).toEqual(['unconfirmed', claim]);
    // It names its own confirmation (§12.2).
    expect((await post(`/v1/ui/claims/${claim}/confirm`, {})).status).toBe(428);
    expect((await claimRow(claim)).confirmed_at).toBeNull();
    const done = await post(`/v1/ui/claims/${claim}/confirm`, { confirm: true });
    expect([done.status, done.json]).toEqual([200, { ok: true }]);
    expect(await claimRow(claim)).toMatchObject({ status: 'completed', confirmed_at: T0 });
    const logged = await events(claim);
    expect(logged.map((e) => e.kind)).toEqual(['confirmed']);
    expect(logged[0].actor.startsWith('owner:')).toBe(true);
    expect((await stateOf('T-1')).state).not.toBe('unconfirmed');
    // Once confirmed it is no unconfirmed completion: neither route finds it.
    expect((await post(`/v1/ui/claims/${claim}/confirm`, { confirm: true })).status).toBe(404);
    expect((await post(`/v1/ui/claims/${claim}/release`, { confirm: true })).status).toBe(404);
  });

  it('release releases one, and the ticket is offered again', async () => {
    const claim = await completion('T-2');
    expect((await post(`/v1/ui/claims/${claim}/release`, { confirm: false })).status).toBe(428);
    const done = await post(`/v1/ui/claims/${claim}/release`, { confirm: true });
    expect([done.status, done.json]).toEqual([200, { ok: true }]);
    expect(await claimRow(claim)).toMatchObject({ status: 'released', end_reason: 'released:requested', confirmed_at: null });
    expect((await events(claim)).map((e) => e.kind)).toEqual(['released']);
    expect((await stateOf('T-2')).state).toBe('ready');
  });

  it('needs a session, and a claim that is no unconfirmed completion is not-found', async () => {
    const claim = await completion('T-1');
    const bare = await hostCall(new Request(`${ORIGIN}/v1/ui/claims/${claim}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ confirm: true }) }));
    expect(bare.status).toBe(401);
    expect((await claimRow(claim)).confirmed_at).toBeNull();
    const none = await post('/v1/ui/claims/999999/confirm', { confirm: true });
    expect([none.status, none.json.code]).toEqual([404, 'not-found']);
    expect((await post(`/v1/ui/claims/${claim}/nonsense`, { confirm: true })).status).toBe(404);
  });

  it('both are the registry’s entries on the ticket’s page, with the fence clear', async () => {
    const res = await sessionCall(cookie, '/v1/actions');
    const actions = ((await res.json()) as { actions: Row[] }).actions;
    const entry = (id: string) => actions.find((a) => a.id === id)!;
    for (const [id, path] of [['claim.confirm', '/v1/ui/claims/{claim}/confirm'], ['claim.release', '/v1/ui/claims/{claim}/release'], ['claim.fence-clear', '/v1/ui/claims/{claim}/fence-clear']]) {
      expect([id, entry(id).http, entry(id).effect, entry(id).ui.view]).toEqual([id, { method: 'POST', path }, 'destructive', ['repository/tickets/{ticket}']]);
      expect(entry(id).callers).toEqual([{ principal: 'session', roles: ['administrator'], scope: 'instance' }]);
    }
  });
});
