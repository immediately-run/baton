// S-BTN-319 / R-BTN-187 (B-137): authenticated sync quotas and delivery-derived control notices.
import { beforeEach, describe, expect, it } from 'vitest';
import { Git, keyCall, observe, setAdminKeys, setClock, SSH_KEYS, syncCall, webhookCall, withCore } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import { SYNC_HOURLY_LIMIT } from '../../src/core/observations';
import type { PolicyDocument } from '../../src/core/policy';

const T0 = Date.parse('2026-11-21T12:00:00Z');
const RESERVE = '/v1/sync/observation';
const BOARD = '/v1/sync/board';
const sha = (n: number) => n.toString(16).padStart(40, '0');

function push(before: string | null, after: string, commit: Record<string, unknown>, forced = false) {
  return webhookCall('push', {
    ref: 'refs/heads/main', before, after, forced,
    repository: { full_name: 'immediately-run/docs', id: 5 },
    pusher: { name: 'worker' }, sender: { id: 42, login: 'worker' },
    head_commit: { author: { email: 'owner@example.com' } },
    commits: [{ id: after, added: [], removed: [], modified: [], ...commit }],
  });
}

beforeEach(() => setClock(T0));

async function addKey() {
  const key = await makeKey('ssh-ed25519', 'docs-sync');
  await withCore((c) => c.registry.addSyncKey('docs', key.publicKey, 'sync', 'admin:test', []));
  return key;
}

async function policy(patch: (doc: PolicyDocument) => void) {
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  const { version, policy } = (await withCore((c) => c.policies.current('docs')))!;
  patch(policy);
  const changed = await keyCall(owner, '/v1/owner/docs/policy', { base_version: version, policy }, 'PUT');
  expect(changed.status, JSON.stringify(changed.json)).toBe(200);
  return owner;
}

describe('S-BTN-319 board boundary', () => {
  it('rejects machine posts and a CI identity excluded by the board policy', async () => {
    const key = await addKey();
    expect((await keyCall(SSH_KEYS['vm-ed'], `${BOARD}?repository=docs`, {})).status).toBe(403);
    await policy((doc) => { doc.inputs.board = ['sync-key']; });
    expect((await keyCall(SSH_KEYS['vm-ed'], `${BOARD}?repository=docs`, {})).status).toBe(403);
    expect((await syncCall(BOARD, { observation: 1 })).status).toBe(403);
    expect((await keyCall(key, RESERVE, {})).status).toBe(200);
  });

  it('does not let CI release or post a key’s observation and frees it on revocation', async () => {
    const key = await addKey();
    const admin = await makeKey('ssh-ed25519', 'admin');
    await setAdminKeys(admin);
    const { observation } = (await keyCall(key, RESERVE, {})).json;
    await syncCall(RESERVE, { release: observation });
    const body = new Git().body('a'.repeat(40), null, { observation });
    expect((await syncCall(BOARD, body)).status).toBe(409);
    expect((await observe()).json.code).toBe('sync-busy');
    const fp = await withCore((c) => c.store.exec<{ fingerprint: string }>('SELECT fingerprint FROM sync_keys WHERE repository_id = ?', 'docs').one().fingerprint);
    expect((await keyCall(admin, `/v1/admin/keys/${encodeURIComponent(fp)}/revoke`, {})).status).toBe(200);
    expect((await observe()).json.observation).toBe(observation + 1);
  });

  it('enforces separate hourly quotas, counts refused posts, and leaves other keys usable', async () => {
    const key = await addKey();
    await withCore((c) => {
      for (let i = 0; i < SYNC_HOURLY_LIMIT; i++) {
        const { observation } = c.observations.observe('docs', 'ci:docs');
        c.observations.release('docs', observation, 'ci:docs');
        if (i < SYNC_HOURLY_LIMIT - 1) c.observations.charge('ci:docs', 'board');
      }
    });
    expect(await observe()).toMatchObject({ status: 429, json: { code: 'rate-limited' } });
    expect((await syncCall(BOARD, { observation: 1 })).status).toBe(400);
    expect((await syncCall(BOARD, { observation: 1 })).status).toBe(429);
    expect((await keyCall(key, RESERVE, {})).status).toBe(200);
    await setClock(T0 + 3_600_000);
    expect((await observe()).status).toBe(200);
  });

  it('alerts the owner after two reservations lapse', async () => {
    const admin = await makeKey('ssh-ed25519', 'admin');
    await setAdminKeys(admin);
    for (const minute of [0, 10, 20]) {
      await setClock(T0 + minute * 60_000);
      expect((await observe()).status).toBe(200);
    }
    expect((await keyCall(admin, '/v1/repositories/docs/needs-you')).json.listings.sync_lapses)
      .toEqual([{ repository_id: 'docs', issuer: 'ci:docs', lapses: 2, at: T0 + 20 * 60_000 }]);
  });

  it('uses only the matching issuer’s observation on a rate-limited post', async () => {
    const key = await addKey();
    await withCore((c) => {
      const { fingerprint } = c.store.exec<{ fingerprint: string }>('SELECT fingerprint FROM sync_keys WHERE repository_id = ?', 'docs').one();
      for (let i = 0; i < SYNC_HOURLY_LIMIT; i++) {
        c.observations.charge(fingerprint, 'board');
        c.observations.charge('ci:docs', 'board');
      }
    });
    const reserved = await observe();
    expect(reserved.status).toBe(200);
    const { observation } = reserved.json;
    const body = (n: number) => new Git().body(sha(1), null, { observation: n });
    expect((await keyCall(key, BOARD, body(observation))).status).toBe(429);
    expect((await syncCall(BOARD, body(observation + 1))).status).toBe(429);
    expect((await keyCall(key, RESERVE, {})).json.code).toBe('sync-busy');
    expect(await syncCall(BOARD, body(observation))).toMatchObject({ status: 429 });
    expect(await keyCall(key, RESERVE, {})).toMatchObject({ status: 200, json: { observation: observation + 1 } });
  });

  it('reports delivery paths absent from the board and never treats missing paths as unchanged', async () => {
    const owner = await policy((doc) => { doc.paths.control = 'human'; });
    const git = new Git();
    expect((await git.post()).status).toBe(200);
    const after = sha(2);
    await push(git.head, after, { added: ['.github/new.yml'], removed: ['ops/AGENTS.md'], modified: ['.baton/baton.json'] });
    expect((await git.post()).status).toBe(200);
    await setClock(T0 + 60_000);
    expect((await git.post()).status).toBe(200);
    const notices = (await keyCall(owner, '/v1/repositories/docs/needs-you')).json.listings.sync_control_changes;
    expect(notices).toMatchObject([
      { sha: git.head, changes: [], unrecorded: 'pusher-unknown' },
      { sha: after, changes: ['.github/new.yml', 'ops/AGENTS.md', '.baton/baton.json'].map((path) => ({ path, pusher: 'worker', pusher_id: 42, commit: after })) },
    ]);
    expect(notices[1]).not.toHaveProperty('unrecorded');

    await setClock(T0 + 120_000);
    await push(git.head, sha(4), { removed: null, modified: undefined });
    expect((await git.post()).status).toBe(200);
    await setClock(T0 + 180_000);
    await push(git.head, sha(5), {}, true);
    expect((await git.post()).status).toBe(200);
    const incomplete = (await keyCall(owner, '/v1/repositories/docs/needs-you')).json.listings.sync_control_changes;
    expect(incomplete.slice(0, 2)).toMatchObject([sha(5), sha(4)].map((sha) => ({ sha, changes: [], unrecorded: 'pusher-unknown' })));

    await setClock(T0 + 240_000);
    await push(git.head, after, {}, true);
    expect((await git.post({ sha: after })).status).toBe(200);
    const returned = (await keyCall(owner, '/v1/repositories/docs/needs-you')).json.listings.sync_control_changes;
    expect(returned.filter((n: { sha: string }) => n.sha === after)).toMatchObject([
      { from: sha(5), sha: after, changes: [], unrecorded: 'pusher-unknown', at: T0 + 240_000 },
    ]);
  });
});
