// S-BTN-295 the grants read, extended (B-199; BATON_SPEC §12.1 R-BTN-179, §8.2 R-BTN-146, §14):
// `GET /v1/owner/{repository}/grants` (`owner.grant.list`) answers the credential and governance
// screens' fields beside what it answered before. Must hold:
//   1. every field it answered before is still there, unchanged — additions only;
//   2. `owners[]` carries `kind` (an API key's `api`, else `ssh`) and `human_only`; `grants[]`
//      `role`, `domain` and `set_by`; `bars[]` `set_by`; `sync_keys` lists the repository's
//      unrevoked sync and mirror keys; `dependency_consents` the consents its owners gave;
//   3. `not_built` names what no table holds — tokens, MCP keys, check-runners, a grant's
//      acceptance, code-repository consents — and no such list is invented;
//   4. NO SECRET leaves: no key's line (an API key's carries its hash), nothing the store keeps
//      of a key but its fingerprint;
//   5. an administrator's session reads the JSON the owner's key reads; another repository's
//      owner, a runner's key and an administrator's key are `forbidden`.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  adminSession, cutover, Git, keyCall, makeApiKey, ORIGIN, rows, sessionCall, setAdminKeys, setClock, withCore,
  setOwnerHumanOnly,
} from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
type Row = Record<string, any>;

let admin: TestKey;
let docsOwner: TestKey;
let opsOwner: TestKey;
let granted: TestKey;
let syncKey: TestKey;
let mirrorKey: TestKey;
let revokedSync: TestKey;
let api: { key: string; line: string };
let cookie: string;

async function read(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Row, text: '' };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  docsOwner = await makeKey('ssh-ed25519', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  granted = await makeKey('ssh-ed25519', 'granted');
  syncKey = await makeKey('ssh-ed25519', 'sync');
  mirrorKey = await makeKey('ssh-ed25519', 'mirror');
  revokedSync = await makeKey('ssh-ed25519', 'sync-old');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml', owner_keys: [opsOwner.publicKey],
  })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', sync_keys_add: [
    { public_key: syncKey.publicKey, role: 'sync' }, { public_key: mirrorKey.publicKey, role: 'mirror' }, { public_key: revokedSync.publicKey, role: 'sync' }] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', sync_keys_remove: [revokedSync.fingerprint], confirm: true })).status).toBe(200);
  // A second owner: a person's API key (R-BTN-159).
  api = await makeApiKey('a person');
  expect((await keyCall(docsOwner, '/v1/owner/docs/owners', { public_key: api.line })).status).toBe(200);
  expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: granted.publicKey, hostname: 'granted-host', label: 'the lab box', capabilities: ['agent-venue'] })).status).toBe(200);
  expect((await new Git().add('T-1').post()).status).toBe(200);
  await cutover(T0);
  expect((await keyCall(docsOwner, '/v1/owner/docs/bars', { course: '*', tag: 'family:x', applies: 'claim', reason: 'audit' })).status).toBe(200);
  // docs' owners consent to ops' tickets depending on docs'.
  expect((await keyCall(docsOwner, '/v1/owner/docs/dependency-consents', { repository: 'ops', confirm: true })).status).toBe(200);
  cookie = await adminSession(admin);
});

describe('S-BTN-295 the grants read, extended (B-199)', () => {
  it('keeps every field it answered and adds the credential screens’ fields', async () => {
    const before = await withCore((c) => c.grantsView('docs'));
    const { status, json } = await read(docsOwner, '/v1/owner/docs/grants');
    expect(status).toBe(200);
    // 1. Additions only: every key `grantsView` answers is there, each old row a subset of the new.
    for (const k of Object.keys(before)) expect([k, k in json]).toEqual([k, true]);
    expect(json.settings).toEqual(JSON.parse(JSON.stringify(before.settings)));
    expect(json.repository).toBe('docs');
    (before.grants as Row[]).forEach((g, i) => expect(json.grants[i]).toMatchObject(JSON.parse(JSON.stringify(g))));
    (before.owners as Row[]).forEach((o) => expect((json.owners as Row[]).find((x) => x.fingerprint === o.fingerprint)).toMatchObject(JSON.parse(JSON.stringify(o))));
    (before.bars as Row[]).forEach((b, i) => expect(json.bars[i]).toMatchObject(JSON.parse(JSON.stringify(b))));
    expect(Object.keys(json).sort()).toEqual(['bars', 'dependency_consents', 'grants', 'not_built', 'owners', 'repository', 'server_time', 'settings', 'sync_keys']);

    // 2. The new fields.
    const owners = json.owners as Row[];
    expect(owners.map((o) => [o.fingerprint, o.kind, o.human_only]).sort()).toEqual([
      [docsOwner.fingerprint, 'ssh', false], [api.key.slice(0, 20), 'api', false]].sort());
    for (const o of owners) expect(Object.keys(o).sort()).toEqual(['added_at', 'added_by', 'fingerprint', 'human_only', 'kind', 'repository_id']);
    await setOwnerHumanOnly(docsOwner.fingerprint);
    await rows(`UPDATE runner_grants SET role = 'trusted-runner', trust_domain = 'lab.example', trust_set_by = ? WHERE credential_id = ?`, `owner:${docsOwner.fingerprint}`, granted.fingerprint);
    const again = (await read(docsOwner, '/v1/owner/docs/grants')).json;
    expect((again.owners as Row[]).find((o) => o.fingerprint === docsOwner.fingerprint)!.human_only).toBe(true);
    expect(json.grants).toHaveLength(1);
    expect(json.grants[0]).toMatchObject({ credential_id: granted.fingerprint, hostname: 'granted-host', label: 'the lab box', role: null, domain: null, set_by: null });
    expect(again.grants[0]).toMatchObject({ role: 'trusted-runner', domain: 'lab.example', set_by: `owner:${docsOwner.fingerprint}` });
    expect(json.bars).toHaveLength(1);
    expect(json.bars[0]).toMatchObject({ tag: 'family:x', reason: 'audit', set_by: `owner:${docsOwner.fingerprint}` });
    expect(json.sync_keys).toEqual([
      { fingerprint: mirrorKey.fingerprint, role: 'mirror', added_by: `admin:${admin.fingerprint}`, added_at: T0 },
      { fingerprint: syncKey.fingerprint, role: 'sync', added_by: `admin:${admin.fingerprint}`, added_at: T0 },
    ]);
    expect(json.dependency_consents).toEqual([{ repository: 'ops', granted_by: `owner:${docsOwner.fingerprint}`, granted_at: T0 }]);

    // 3. What is not built is named, and no list stands in for it.
    expect(json.not_built).toEqual({ tokens: 'R-BTN-117', mcp_keys: 'B-124', check_runners: 'B-290', grant_acceptance: 'R-BTN-146', code_repo_consents: 'R-BTN-140' });
    for (const k of ['tokens', 'mcp_keys', 'check_runners', 'consents']) expect([k, k in json]).toEqual([k, false]);
    for (const k of ['pending', 'sync', 'checker']) expect([k, k in json.grants[0]]).toEqual([k, false]);
  });

  it('serves no secret: no key line, no API key hash, nothing of a key but its fingerprint', async () => {
    const res = await sessionCall(cookie, '/v1/owner/docs/grants');
    expect(res.status).toBe(200);
    const text = await res.text();
    // What the store holds of each key, beside its fingerprint.
    const held = [
      ...(await rows<{ public_key: string }>('SELECT public_key FROM repository_owners')).map((r) => r.public_key),
      ...(await rows<{ public_key: string }>('SELECT public_key FROM sync_keys')).map((r) => r.public_key),
      ...(await rows<{ public_key: string | null }>('SELECT public_key FROM credentials WHERE public_key IS NOT NULL')).map((r) => r.public_key!),
    ];
    expect(held.length).toBeGreaterThanOrEqual(5);
    for (const line of held) {
      // The key material: the base64 of an SSH line, the hash of an API key's.
      const material = line.split(' ')[1];
      expect(material.length).toBeGreaterThan(20);
      expect([material, text.includes(material)]).toEqual([material, false]);
    }
    expect(text.includes(api.key)).toBe(false);
    expect(text.includes(cookie.split('=')[1])).toBe(false);
    expect(/public_key|secret|token_hash|id_hash|api_key"/.test(text)).toBe(false);
  });

  it('an administrator’s session reads what the owner’s key reads; other callers are forbidden', async () => {
    const viaKey = (await read(docsOwner, '/v1/owner/docs/grants')).json;
    const res = await sessionCall(cookie, '/v1/owner/docs/grants');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(viaKey);
    // The API key owner reads it too.
    const bearer = await hostCall(new Request(`${ORIGIN}/v1/owner/docs/grants`, { headers: { Authorization: `Bearer ${api.key}` } }));
    expect(bearer.status).toBe(200);
    expect(((await bearer.json()) as Row).sync_keys).toEqual(viaKey.sync_keys);
    for (const key of [opsOwner, granted, admin]) {
      const refused = await read(key, '/v1/owner/docs/grants');
      expect([key.name, refused.status, refused.json.code]).toEqual([key.name, 403, 'forbidden']);
    }
    const stranger = await read(await makeKey('ssh-ed25519', 'stranger'), '/v1/owner/docs/grants');
    expect([stranger.status, stranger.json.code]).toEqual([401, 'unauthenticated']);
  });
});
