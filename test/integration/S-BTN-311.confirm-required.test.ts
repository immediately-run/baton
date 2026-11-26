// §12.2: a confirmation is a second refusal, not authority. Run on both hosts.
import { expect, it } from 'vitest';
import { adminSession, keyCall, register, rows, seedClaim, seedPolicyFloor, sessionCall, setAdminKeys, setClock, setHumanKeys } from '../helpers';
import { makeKey, sshsig } from '../lib/sshKeys';

it('S-BTN-311: every live destructive action in §12.2 requires literal true and otherwise leaves its target unchanged', async () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  await setClock(now);
  const [admin, owner, other, worker, human] = await Promise.all(
    ['admin', 'owner', 'other-owner', 'worker', 'human'].map((name) => makeKey('ssh-ed25519', name)));
  await setAdminKeys(admin);
  await setHumanKeys(owner);
  const adminRepo = '/v1/admin/repositories';
  const owners = '/v1/owner/docs/owners';
  const floors = '/v1/owner/docs/policy/floors';
  const call = async (...args: Parameters<typeof keyCall>) => {
    const result = await keyCall(...args);
    expect(result.status, JSON.stringify(result.json)).toBe(200);
  };
  await call(admin, adminRepo, { id: 'docs', owner_keys_add: [owner.publicKey, other.publicKey] });
  await call(owner, '/v1/owner/docs/grants', { public_key: worker.publicKey, hostname: 'worker', capabilities: [] });
  const signature = await sshsig(owner, new TextEncoder().encode(human.publicKey.trim()), 'baton-human-keys@1');
  await call(owner, '/v1/human-keys', { public_key: human.publicKey, signature: btoa(String.fromCharCode(...signature)) });
  // A pre-existing floor with an owner as remove_by; S-BTN-190 covers registration and guarantees.
  await seedPolicyFloor({ repository_id: 'docs', name: 'my-floor', guarantees: '["human-gates"]', remove_by: 'owner', added_by: owner.fingerprint, added_at: now });
  const runner = await register();
  const claim = await seedClaim(runner.id, 'docs:T-1', now);
  const cookie = await adminSession(admin);
  const postUi = async (path: string, body: object) => {
    const response = await sessionCall(cookie, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };

  const grant = `/v1/owner/docs/grants/${encodeURIComponent(worker.fingerprint)}/revoke`;
  const key = `/v1/admin/keys/${encodeURIComponent(worker.fingerprint)}/revoke`;
  for (const confirmation of [{}, { confirm: true }]) {
    expect((await keyCall(admin, grant, confirmation)).json.code).toBe('forbidden');
    expect((await keyCall(owner, key, confirmation)).json.code).toBe('forbidden');
  }
  expect((await keyCall(admin, key, undefined, 'POST')).json.code).toBe('confirm-required');

  const actions = [
    ['leg.stop', (c: object) => postUi('/v1/ui/messages', { to_runner_id: runner.id, kind: 'release', payload: { ticket_id: 'docs:T-1', reason: 'requested' }, ...c }),
      () => rows('SELECT 1 FROM messages WHERE to_runner_id = ? AND kind = ?', runner.id, 'release')],
    ['claim.force-reap', (c: object) => postUi(`/v1/ui/claims/${claim}/reap`, c),
      () => rows('SELECT status FROM claims WHERE id = ?', claim)],
    ['claim.fence-clear', (c: object) => postUi(`/v1/ui/claims/${claim}/fence-clear`, c),
      () => rows('SELECT fence_pending FROM claims WHERE id = ?', claim)],
    ['owner.owner.remove', (c: object) => keyCall(owner, owners, { fingerprint: other.fingerprint, remove: true, ...c }),
      () => rows('SELECT removed_at FROM repository_owners WHERE repository_id = ? AND fingerprint = ?', 'docs', other.fingerprint)],
    ['owner.grant.revoke', (c: object) => keyCall(owner, grant, c),
      () => rows('SELECT revoked_at FROM runner_grants WHERE repository_id = ? AND credential_id = ?', 'docs', worker.fingerprint)],
    ['human-key.revoke', (c: object) => keyCall(owner, '/v1/human-keys', { fingerprint: human.fingerprint, revoke: true, ...c }),
      () => rows('SELECT revoked_at FROM human_keys WHERE fingerprint = ?', human.fingerprint)],
    ['admin.key.revoke', (c: object) => keyCall(admin, key, c),
      () => rows('SELECT revoked_at FROM credentials WHERE id = ?', worker.fingerprint)],
    ['owner.policy.floor.remove', (c: object) => keyCall(owner, floors, { name: 'my-floor', remove: true, ...c }),
      () => rows('SELECT name FROM policy_floors WHERE repository_id = ?', 'docs')],
    ['admin.repo.retire', (c: object) => keyCall(admin, adminRepo, { id: 'docs', retire: true, ...c }),
      () => rows('SELECT retired_at FROM repositories WHERE id = ?', 'docs')],
  ] as const;
  for (const [action, send, state] of actions) {
    const before = await state();
    for (const confirmation of [{}, { confirm: false }, { confirm: 'true' }]) {
      expect(await send(confirmation), action).toMatchObject({ status: 428, json: { code: 'confirm-required' } });
      expect(await state(), action).toEqual(before);
    }
    const confirmed = await send({ confirm: true });
    expect(confirmed.status, `${action}: ${JSON.stringify(confirmed.json)}`).toBe(200);
    expect(await state(), action).not.toEqual(before);
  }
});
