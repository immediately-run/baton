import { expect, inject, it } from 'vitest';
import { hbBody, keyCall, adminSession, sessionCall, ORIGIN, payload, course, cutover, setAdminKeys, setClock, sha256, syncCall, tick, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call } from '#host';
import type { Config } from '../../src/core/ports';
import { forgeScope } from '../../src/core/forgeScope';
import type { BatonError } from '../../src/core/http';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';

const board = inject('board');
const now = Date.parse('2026-11-21T12:00:00Z');

async function checkScope(armed: boolean) {
  await setClock(now);
  const [admin, owner, runner, other, broker] = await Promise.all(['admin', 'owner', 'runner', 'other', 'broker'].map((name) => makeKey('ssh-ed25519', name)));
  const setBroker = (line?: string) => withCore((core) => {
    (core as unknown as { ports: { config: Config } }).ports.config.BATON_FORGE_BROKER_KEYS = line;
  });
  await setBroker(broker.publicKey);
  try {
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/docs/settings', { code_repos: [
      { path: 'immediately-run/fieldhouse', repo_id: '123', owner_id: '456' },
      { path: 'immediately-run/unused', repo_id: '789', owner_id: '456' },
    ] }, 'PUT')).status).toBe(200);
    const snapshot = structuredClone(board.states.A);
    Object.assign(snapshot.state.items[0] as Record<string, unknown>, { repos: ['fieldhouse', 'baton'] });
    const registry = armed ? [course(3, 3, { course: {
      ...roadmapPr, legs: { ...roadmapPr.legs, implement: { ...roadmapPr.legs.implement, max_duration: 300 } },
    } })] : [course()];
    expect((await syncCall('/v1/sync/board', payload(board.shas.A, null, snapshot, { registry }))).status).toBe(200);
    await cutover(1, 'docs');
    const secret = 'secret-k';
    const runnerCall = async (key: TestKey, path: string, body?: unknown, session: string | null = secret) => {
      const created = Math.floor((await withCore((c) => c.now())) / 1000);
      return call(await signedRequest(key, ORIGIN + path, { created,
        body: body === undefined ? undefined : JSON.stringify(body), headers: session ? { 'X-Runner-Secret': session } : {} }));
    };
    let runnerId = 0;
    for (const [key, hostname] of [[runner, 'k-host'], [other, 'other-host']] as const) {
      expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: key.publicKey, hostname, capabilities: ['agent-venue'] })).status).toBe(200);
      const beat = await runnerCall(key, '/v1/runner/heartbeat', hbBody('vm-a', { hostname, secret_hash: await sha256(secret) }));
      expect(beat.status).toBe(200);
      if (key === runner) runnerId = (await beat.json() as { runner_id: number }).runner_id;
    }
    const second = 'secret-second-session';
    const secondBeat = await runnerCall(runner, '/v1/runner/heartbeat', hbBody('vm-a', {
      hostname: 'k-host', session_name: 'second-session', secret_hash: await sha256(second),
    }), second);
    expect(secondBeat.status).toBe(200);
    expect((await secondBeat.json() as { runner_id: number }).runner_id).not.toBe(runnerId);
    const claimed = await runnerCall(runner, '/v1/runner/claim', { request_id: 'req-b131', ticket_id: 'docs:R3-9001' });
    expect(claimed.status).toBe(200);
    const { claim_id } = await claimed.json() as { claim_id: number };
    const advance = await runnerCall(runner, `/v1/runner/claims/${claim_id}/advance`, { leg: 'implement' });
    expect(advance.status).toBe(200);
    const { run_id } = await advance.json() as { run_id: string };
    const scope = `/v1/forge-scope/broker/${run_id}`;
    const proof = `/v1/forge-scope/runner/${run_id}`;
    expect((await runnerCall(runner, proof)).status).toBe(204);
    expect((await runnerCall(runner, proof, undefined, second)).status).toBe(404);
    expect((await runnerCall(runner, proof, undefined, null)).status).toBe(401);
    expect((await runnerCall(other, proof)).status).toBe(404);
    expect((await runnerCall(runner, scope)).status).toBe(401);
    expect((await runnerCall(broker, proof)).status).toBe(401);
    expect((await runnerCall(broker, '/v1/admin/state')).status).toBe(401);
    const read = await runnerCall(broker, scope);
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    expect(await read.json()).toEqual({ repositories: [
      { path: 'immediately-run/docs', id: null }, { path: 'immediately-run/fieldhouse', id: '123' },
    ], valid_until: armed ? now + 300_000 : expect.any(Number) });
    if (armed) {
      await setClock(now + 300_000);
      await tick();
      expect(await withCore((core) => core.store.exec('SELECT status, deadline_at FROM claims WHERE id = ?', claim_id).one()))
        .toMatchObject({ status: 'active', deadline_at: null });
      expect((await runnerCall(broker, scope)).status).toBe(404);
      expect((await runnerCall(runner, proof)).status).toBe(404);
      return;
    }
    const requested = await sessionCall(await adminSession(admin), '/v1/ui/messages', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'release', confirm: true, to_runner_id: runnerId,
        payload: { ticket_id: 'docs:R3-9001', reason: 'requested' } }) });
    expect(requested.status).toBe(200);
    const { id } = await requested.json() as { id: number };
    expect((await runnerCall(broker, scope)).status).toBe(200);
    const delivered = await runnerCall(runner, '/v1/runner/heartbeat', hbBody('vm-a', { hostname: 'k-host' }));
    expect((await delivered.json() as { messages: unknown[] }).messages).toContainEqual(expect.objectContaining({ id, kind: 'release' }));
    expect((await runnerCall(broker, scope)).status).toBe(200);
    expect((await runnerCall(runner, `/v1/runner/messages/${id}/ack`, {})).status).toBe(200);
    expect((await runnerCall(broker, scope)).status).toBe(200);
    await setClock(now + 899_000);
    expect((await runnerCall(runner, proof)).status).toBe(204);
    // Past the lease the scope is gone. Read in the object at that instant rather than by moving
    // the clock there: the fake clock is behind the real one, so an armed alarm is overdue and
    // workerd may run it in the background, reaping the claim before the end below.
    expect(await withCore((core) => {
      try {
        forgeScope(core.store, now + 901_000, run_id);
        return 'found';
      } catch (e) {
        return (e as BatonError).code;
      }
    })).toBe('not-found');
    expect((await runnerCall(runner, `/v1/runner/claims/${claim_id}/end`, { end_reason: 'released:requested' })).status).toBe(200);
    expect((await runnerCall(broker, scope)).status).toBe(404);
  } finally {
    await setBroker();
  }
}

// B-131's historical ID is retained pending registration of a separate broker scenario.
it('S-BTN-310: only the holder can prove a run; only the broker can read its live, owner-listed scope', () => checkScope(false));
it('B-131: the timeout tick does not restore broker scope or runner proof', () => checkScope(true));
