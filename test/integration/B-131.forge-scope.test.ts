import { expect, inject, it } from 'vitest';
import { hbBody, keyCall, adminSession, sessionCall, ORIGIN, payload, cutover, setAdminKeys, setClock, sha256, syncCall, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call } from '#host';
import type { Config } from '../../src/core/ports';

const board = inject('board');
const now = Date.parse('2026-11-21T12:00:00Z');

it('S-BTN-310: only the holder can prove a run; only the broker can read its live, owner-listed scope', async () => {
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
    expect((await syncCall('/v1/sync/board', payload(board.shas.A, null, snapshot))).status).toBe(200);
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
    ], valid_until: expect.any(Number) });
    const requested = await sessionCall(await adminSession(admin), '/v1/ui/messages', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'release', to_runner_id: runnerId,
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
    await setClock(now + 901_000);
    expect((await runnerCall(broker, scope)).status).toBe(404);
    await setClock(now + 1000);
    expect((await runnerCall(runner, `/v1/runner/claims/${claim_id}/end`, { end_reason: 'released:requested' })).status).toBe(200);
    expect((await runnerCall(broker, scope)).status).toBe(404);
  } finally {
    await setBroker();
  }
});
