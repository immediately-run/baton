// S-BTN-323 / G-BTN-174 (R-BTN-186): key equivalents of session writes on both hosts.
import { beforeEach, describe, expect, it } from 'vitest';
import { ACTIONS, keyCaller, listsSession, matchAction } from '../../src/core/actions';
import { captureDispatches, claimRow, keyCall, register, rows, withCore } from '../helpers';
import { grantedRunner } from '../lib/fleet';
import { fixture, postSession, readSession, running, T0, type Fixture } from '../lib/needsYouFixture';

let f: Fixture;
beforeEach(async () => { f = await fixture(); });

const send = (surface: string, tail: string, body: unknown) => surface === 'ui'
  ? postSession(f.cookie, `/v1/ui/${tail}`, body)
  : keyCall(surface === 'admin' ? f.admin : f.owner, `/v1/${surface === 'admin' ? 'admin' : 'owner/docs'}/${tail}`, body);

function stop(id: number, ticket = 'docs:A') {
  return { to_runner_id: id, kind: 'release', payload: { ticket_id: ticket, reason: 'requested' }, confirm: true };
}

describe('S-BTN-323 session writes have key equivalents', () => {
  it('lists a key route for every session write except logout, and matches each role and discriminator', () => {
    const writes = ACTIONS.filter((a) => a.effect !== 'read' && listsSession(a));
    expect(writes.filter((a) => a.sessionOnly).map((a) => a.id)).toEqual(['ui.logout']);
    for (const a of writes.filter((a) => !a.sessionOnly)) {
      const sample = (path: string) => path.replaceAll(/\{[^}]+\}/g, '1');
      const body = Object.fromEntries(Object.entries(a.http.match ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
      expect(matchAction('POST', sample(a.ui!.route!.path), body)?.action.id).toBe(a.id);
      expect(matchAction('POST', sample(a.http.path), body)?.action.id).toBe(a.id);
      expect(keyCaller(a, 'administrator')).not.toBeNull();
      if (a.callers.some((c) => c.roles?.includes('owner'))) {
        expect(keyCaller(a, 'owner')).not.toBeNull();
        expect(matchAction('POST', sample(a.ownerHttp!.path), body)?.action.id).toBe(a.id);
      }
    }
  });

  it.each(['ui', 'admin'])('reaps and clears the fence via %s', async (surface) => {
    const { claimId } = await running();
    for (const verb of ['reap', 'fence-clear']) {
      expect((await send(surface, `claims/${claimId}/${verb}`, { confirm: 'true' })).json.code).toBe('confirm-required');
      expect((await keyCall(f.owner, `/v1/admin/claims/${claimId}/${verb}`, { confirm: true })).json.code).toBe('forbidden');
      expect((await send(surface, `claims/${claimId}/${verb}`, { confirm: true })).status).toBe(200);
    }
    expect(await claimRow(claimId)).toMatchObject({ status: 'reaped', fence_pending: 0 });
    expect((await send(surface, `claims/${claimId}/fence-clear`, { confirm: true })).json.code).toBe('conflict');
  });

  it.each(['ui', 'admin', 'owner'])('holds, expedites and lifts the hold via %s', async (surface) => {
    const tail = surface === 'owner' ? 'overrides/A' : 'overrides/docs:A';
    const overrides = async () => (await readSession(f.cookie, '/v1/repositories/docs/tickets/A')).json.overrides;
    expect((await send(surface, tail, { hold: 'yes' })).json.code).toBe('invalid-params');
    expect((await send(surface, tail, { hold: true })).status).toBe(200);
    expect((await overrides()).hold).not.toBeNull();
    expect((await send(surface, tail, { expedite: true })).status).toBe(200);
    expect((await send(surface, tail, { hold: false })).status).toBe(200);
    expect(await overrides()).toMatchObject({ hold: null, expedite: true });
    expect((await send(surface, tail, { expedite: false })).status).toBe(200);
    expect((await overrides()).expedite).toBe(false);
    expect((await keyCall(f.owner, '/v1/owner/ops/overrides/A', { hold: true })).json.code).toBe('forbidden');
    expect((await keyCall(f.owner, '/v1/owner/docs/overrides/ops:A', { hold: true })).json.code).toBe('invalid-params');
  });

  it.each(['ui', 'admin', 'owner'])('stops, requests status and drains via %s', async (surface) => {
    await running();
    const { claim } = (await readSession(f.cookie, '/v1/repositories/docs/tickets/A')).json;
    const runner = claim.runner_id;
    expect((await send(surface, 'messages', { ...stop(runner), confirm: false })).json.code).toBe('confirm-required');
    expect((await send(surface, 'messages', stop(runner, 'docs:other'))).json.code).toBe('forbidden');
    expect((await send(surface, 'messages', stop(runner))).status).toBe(200);
    const single = await grantedRunner(f.owner, 'docs', 'single', ['agent-venue']);
    for (const kind of ['status_request', 'wind-down']) {
      expect((await send(surface, 'messages', { to_runner_id: single.id, kind })).status).toBe(200);
      expect((await keyCall(f.opsOwner, '/v1/owner/ops/messages', { to_runner_id: single.id, kind })).json.code).toBe('forbidden');
    }
    expect(await rows('SELECT kind, to_runner_id FROM messages ORDER BY id')).toEqual([
      { kind: 'release', to_runner_id: runner }, { kind: 'status_request', to_runner_id: single.id }, { kind: 'wind-down', to_runner_id: single.id },
    ]);
    const other = await register('vm-b');
    expect((await send(surface, 'messages', stop(other.id))).json.code).toBe('forbidden');
  });

  it.each(['ui', 'admin', 'owner'])('resolves only a finding in scope via %s', async (surface) => {
    await withCore((c) => {
      c.store.exec(`INSERT INTO scope_findings (id, repository_id, kind, target, detail_json, raised_at, updated_at)
        VALUES (1, 'docs', 'unclaimed-write', 'docs', '{}', ?, ?)`, T0, T0);
    });
    expect((await keyCall(f.opsOwner, '/v1/owner/ops/scope/1/resolve', {})).json.code).toBe('not-found');
    expect((await send(surface, 'scope/1/resolve', {})).status).toBe(200);
    expect((await send(surface, 'scope/1/resolve', {})).json.code).toBe('not-found');
    expect(await rows('SELECT resolved_at FROM scope_findings')).toEqual([{ resolved_at: T0 }]);
  });

  it.each(['ui', 'admin', 'owner'])('dispatches a sync and shares its throttle via %s', async (surface) => {
    const dispatched = await captureDispatches();
    expect((await send(surface, 'resync', { repository: 'docs', force: true })).json.code).toBe('invalid-params');
    expect((await send(surface, 'resync', { repository: 'docs' })).status).toBe(200);
    expect((await send(surface === 'ui' ? 'admin' : 'ui', 'resync', { repository: 'docs' })).json.code).toBe('conflict');
    expect((await keyCall(f.owner, '/v1/owner/docs/resync', { repository: 'ops' })).json.code).toBe('forbidden');
    expect(dispatched).toEqual(['docs:sync']);
  });
});
