// S-BTN-296 the registry read (B-202; BATON_SPEC §3.1 R-BTN-47, §11.2 R-BTN-58, §14): `GET
// /v1/admin/repositories` (`admin.repo.list`) answers an administrator's key as it did and an
// administrator's session the same JSON, each row with the registry's own fields. Must hold:
//   1. the key's answer keeps the registry fields other than retired tiers and `seed_owners`, and
//      a row is still `GET /v1/admin/state`'s repository row beside the new fields;
//   2. each row carries `sync_keys: [{fingerprint, role}]` (unrevoked), `ci_identity`
//      and `retired_at` (null while live);
//   3. a retired repository is listed only with `?retired=1`, marked by `retired_at`;
//   4. an administrator's session reads what the key reads;
//   5. NO SECRET leaves: no key line, no `remote` (a URL may carry a credential).
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, cutover, Git, keyCall, ORIGIN, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
type Row = Record<string, any>;

let admin: TestKey;
let docsOwner: TestKey;
let opsOwner: TestKey;
let syncKey: TestKey;
let cookie: string;

async function read(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Row };
}
const rowOf = (answer: Row, id: string): Row => (answer.repositories as Row[]).find((r) => r.id === id)!;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  docsOwner = await makeKey('ssh-ed25519', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  syncKey = await makeKey('ssh-ed25519', 'sync');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml', owner_keys: [opsOwner.publicKey], tiers: 'invalid-old-ladder',
  })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey], sync_keys_add: [{ public_key: syncKey.publicKey, role: 'sync' }] })).status).toBe(200);
  expect((await new Git().add('T-1').post()).status).toBe(200);
  await cutover(T0);
  cookie = await adminSession(admin);
});

describe('S-BTN-296 the registry read (B-202)', () => {
  it('answers the key with registry fields, not the retired tier ladder', async () => {
    const view = JSON.parse(JSON.stringify(await withCore((c) => c.adminView()))) as Row;
    const state = (await read(admin, '/v1/admin/state')).json;
    const { status, json } = await read(admin, '/v1/admin/repositories');
    expect(status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(['repositories', 'seed_owners']);
    expect(json.seed_owners).toEqual(await withCore((c) => c.admin.seedOwnedRepositories()));
    expect((json.repositories as Row[]).map((r) => r.id)).toEqual(['baton', 'docs', 'ops']);
    for (const old of view.repositories as Row[]) {
      const row = rowOf(json, old.id);
      expect(row).not.toHaveProperty('tiers');
      expect(row).toMatchObject(old);
      expect(row).toMatchObject(rowOf(state, old.id));
      expect(Object.keys(row).sort()).toEqual([...Object.keys(old), 'ci_identity', 'retired_at', 'sync_keys'].sort());
    }
    const docs = rowOf(json, 'docs');
    expect(docs.sync_keys).toEqual([{ fingerprint: syncKey.fingerprint, role: 'sync' }]);
    expect(docs.retired_at).toBeNull();
    expect(docs.ci_identity).toEqual((await withCore((c) => c.registry.get('docs')))!.ci_identity);
    expect(rowOf(json, 'ops').sync_keys).toEqual([]);

    // 4. The session's JSON is the key's.
    const res = await sessionCall(cookie, '/v1/admin/repositories');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(json);
    // 5. No key line, no remote.
    const lines = [
      ...(await rows<{ public_key: string }>('SELECT public_key FROM sync_keys')).map((r) => r.public_key),
      ...(await rows<{ public_key: string }>('SELECT public_key FROM repository_owners')).map((r) => r.public_key),
    ];
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect(text.includes(line.split(' ')[1])).toBe(false);
    const remotes = (await rows<{ remote: string }>('SELECT remote FROM repositories')).map((r) => r.remote).filter((r) => r);
    expect(remotes.length).toBeGreaterThan(0);
    for (const remote of remotes) expect(text.includes(remote)).toBe(false);
    expect(/"remote"|public_key|secret/.test(text)).toBe(false);
  });

  it('lists a retired repository only with ?retired=1, marked', async () => {
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', retire: true, confirm: true })).status).toBe(200);
    const live = (await read(admin, '/v1/admin/repositories')).json;
    expect((live.repositories as Row[]).map((r) => r.id)).toEqual(['baton', 'docs']);
    const all = (await read(admin, '/v1/admin/repositories?retired=1')).json;
    expect((all.repositories as Row[]).map((r) => r.id)).toEqual(['baton', 'docs', 'ops']);
    const ops = rowOf(all, 'ops');
    expect(ops.retired_at).toBe(T0);
    expect([ops.head, ops.courses, ops.sync_keys]).toEqual([null, [], []]);
    expect(Object.keys(ops).sort()).toEqual(Object.keys(rowOf(all, 'docs')).sort());
    expect(rowOf(all, 'docs').retired_at).toBeNull();
    const viaSession = await (await sessionCall(cookie, '/v1/admin/repositories?retired=1')).json() as Row;
    expect(viaSession).toEqual(all);
  });
});
