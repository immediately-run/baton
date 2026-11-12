// S-BTN-215 code repository settings refused (BATON_SPEC §15 S-BTN-215, §3.4 R-BTN-140,
// R-BTN-139, §12.8 R-BTN-188; B-182): the owners' `code_repos` and `pushers` lists, and the
// refusals around a code repository on another host than the home's. Must hold: a duplicate
// path — across hosts, or one repeating the home's own path — is refused `invalid-params`;
// on a `git` home an entry without `forge` and `host`, a `forge: git` entry and a host-less
// pushers entry are each refused naming the entry; a cross-host entry is refused while the
// policy names a `human_identity` or a floor stands, and a policy version or floor setting one
// is refused while such an entry exists (no human identity across hosts yet); a forge home
// accepts host-less entries and pushers as the home's, stored with the home's forge, host and
// a derived `web_base`. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { keyCall, observe, ORIGIN, rows, setAdminKeys, setClock } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { COOPERATIVE } from '../../src/core/policy';

const T0 = Date.parse('2026-11-12T12:00:00Z');
let admin: TestKey;
let owner: TestKey;
let plain: TestKey;
let syncKey: TestKey;

/** `PUT /v1/owner/{repository}/settings` as the repository's owner. */
const settings = (repository: string, body: unknown) => keyCall(owner, `/v1/owner/${repository}/settings`, body, 'PUT');
/** `PUT /v1/owner/{repository}/policy` as the repository's owner. */
const policy = (repository: string, body: unknown) => keyCall(owner, `/v1/owner/${repository}/policy`, body, 'PUT');

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  plain = await makeKey('ssh-ed25519', 'plain-owner');
  syncKey = await makeKey('ssh-ed25519', 'plain-sync');
  await setAdminKeys(admin);
  // docs is the harness's seeded repository, a github forge home on github.com; plain is a
  // plain git home — no forge, no host of its own.
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'plain', github: 'you/home', forge: 'git', remote: 'ssh://git@localhost/home.git', default_branch: 'main',
    sync_keys: [{ public_key: syncKey.publicKey, role: 'sync' }], owner_keys: [plain.publicKey],
  })).status).toBe(200);
});

describe('S-BTN-215 code repository settings refused', () => {
  it('a forge home accepts host-less code_repos and pushers as the home\'s, stored defaulted', async () => {
    // Adding either is reach gained, so it is governed (R-BTN-186): the owner key is the
    // approver on the seeded `cooperative` policy.
    expect((await settings('docs', { code_repos: [{ path: 'immediately-run/site', repo_id: '10', owner_id: '5' }], pushers: [{ id: '7' }] })).status).toBe(200);
    expect(await rows('SELECT path, forge, host, repo_id, owner_id, web_base FROM code_repos WHERE repository_id = ?', 'docs')).toEqual([
      { path: 'immediately-run/site', forge: 'github', host: 'github.com', repo_id: '10', owner_id: '5', web_base: 'https://github.com/immediately-run/site' },
    ]);
    expect(JSON.parse((await rows<{ pushers: string }>('SELECT pushers FROM repositories WHERE id = ?', 'docs'))[0].pushers)).toEqual([{ host: 'github.com', id: '7' }]);
    // R-BTN-140: the observation hands the sync the effective list, ids and web_base with it,
    // and the pushers host-qualified.
    const o = await observe();
    expect(o.json.code_repos).toEqual([{ path: 'immediately-run/site', forge: 'github', host: 'github.com', repo_id: '10', owner_id: '5', web_base: 'https://github.com/immediately-run/site' }]);
    expect(o.json.pushers).toEqual([{ host: 'github.com', id: '7' }]);
  });

  it('a duplicate path — across hosts, or repeating the home\'s — is refused invalid-params', async () => {
    const twoHosts = await settings('docs', { code_repos: [
      { path: 'o/x', forge: 'github', host: 'github.com', repo_id: '1', owner_id: '1' },
      { path: 'O/X', forge: 'gitea', host: 'gitea.example.com', repo_id: '2', owner_id: '2' },
    ] });
    expect(twoHosts).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(twoHosts.json.message).toContain('code_repos[1].path');
    expect(twoHosts.json.message).toContain('unique case-insensitively');
    // The home's own path holds its name across every host (R-BTN-92).
    const homePath = await settings('docs', { code_repos: [{ path: 'immediately-run/docs', forge: 'gitlab', host: 'gitlab.example.com', repo_id: '3', owner_id: '3' }] });
    expect(homePath).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(homePath.json.message).toContain('code_repos[0].path');
  });

  it('a git home refuses an entry without forge and host, a forge: git entry and a host-less pusher', async () => {
    const noForge = await keyCall(plain, '/v1/owner/plain/settings', { code_repos: [{ path: 'acme/monorepo', repo_id: '7', owner_id: '3' }] }, 'PUT');
    expect(noForge).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(noForge.json.message).toContain('code_repos[0].forge');
    expect(noForge.json.message).toContain('a git home names no forge of its own');
    // A `git` code repository is refused on any home: it has no PR facts to read.
    const gitEntry = await settings('docs', { code_repos: [{ path: 'acme/monorepo', forge: 'git', host: 'localhost', repo_id: '7', owner_id: '3' }] });
    expect(gitEntry).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(gitEntry.json.message).toContain('a git code repository has no PR facts to read');
    const noHostPusher = await keyCall(plain, '/v1/owner/plain/settings', { pushers: [{ id: '5' }] }, 'PUT');
    expect(noHostPusher).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(noHostPusher.json.message).toContain('pushers[0].host');
    expect(noHostPusher.json.message).toContain('a git home names no host of its own');
  });

  it('point 7 refuses in both orders: no human identity or floor across hosts', async () => {
    // Order 1: the policy names a human_identity, and a cross-host entry is then refused.
    const set = await policy('docs', { base_version: 1, policy: { ...COOPERATIVE, human_identity: '4242' } });
    expect(set.status).toBe(200);
    expect(set.json.changed).toEqual(['human_identity']);
    const entry = await settings('docs', { code_repos: [{ path: 'acme/monorepo', forge: 'github', host: 'github.acme.example.com', repo_id: '7', owner_id: '3' }] });
    expect(entry).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(entry.json.message).toContain('acme/monorepo');
    expect(entry.json.message).toContain('another host than the home\'s');
    // An entry on the home's own host lands: it is not the refused combination.
    expect((await settings('docs', { code_repos: [{ path: 'immediately-run/site', repo_id: '10', owner_id: '5' }] })).status).toBe(200);
    // Order 2 (on ops, whose policy names no human_identity): the cross-host entry exists, and a
    // policy version setting a human_identity — or a floor — is refused naming the knob;
    // removing the entry lifts the refusal.
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', forge: 'github', remote: 'ssh://git@github.com/immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', sync_keys: [], owner_keys: [owner.publicKey] })).status).toBe(200);
    expect((await settings('ops', { code_repos: [{ path: 'acme/monorepo', forge: 'github', host: 'github.acme.example.com', repo_id: '7', owner_id: '3' }] })).status).toBe(200);
    const identity = await policy('ops', { base_version: 1, policy: { ...COOPERATIVE, human_identity: '4242' } });
    expect(identity).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(identity.json.message).toContain('policy.human_identity');
    expect(identity.json.message).toContain('acme/monorepo');
    const floor = await keyCall(owner, '/v1/owner/ops/policy/floors', { name: 'cross-host', guarantees: ['human-gates'] });
    expect(floor).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(floor.json.message).toContain('no floor may stand');
    // The list without the cross-host entry is accepted, and the identity with it.
    expect((await settings('ops', { code_repos: [] })).status).toBe(200);
    expect((await policy('ops', { base_version: 1, policy: { ...COOPERATIVE, human_identity: '4242' } })).status).toBe(200);
  });

  it('a re-written list keeps a kept path\'s ids — new ids enter only with a path the list did not hold', async () => {
    // First write: one entry, ids 7001/31.
    expect((await settings('docs', { code_repos: [{ path: 'acme/monorepo', repo_id: '7001', owner_id: '31' }] })).status).toBe(200);
    const was = await rows('SELECT path, forge, host, repo_id, owner_id, web_base, added_by, added_at FROM code_repos WHERE repository_id = ?', 'docs');
    // The routine re-write — the CLI re-reads every entry's ids on each `--code-repos` run, and
    // a second entry is being added — now posts different ids for the kept path (the forge
    // re-created it under the same spelling). R-BTN-140: the kept row keeps its ids, host and
    // web_base whole, so the re-created path gains no reach here — the sync's id check
    // (S-BTN-216) fails on the new ids instead, and adopting them takes the governed two-step
    // below. Only the new entry's ids land as posted.
    expect((await settings('docs', { code_repos: [
      { path: 'acme/monorepo', repo_id: '8888', owner_id: '31' },
      { path: 'immediately-run/site', repo_id: '10', owner_id: '5' },
    ] })).status).toBe(200);
    const kept = await rows('SELECT path, forge, host, repo_id, owner_id, web_base, added_by, added_at FROM code_repos WHERE repository_id = ? ORDER BY path', 'docs');
    expect(kept.find((r) => r.path === 'acme/monorepo')).toEqual(was[0]);
    expect(kept.find((r) => r.path === 'immediately-run/site')).toMatchObject({ forge: 'github', host: 'github.com', repo_id: '10', owner_id: '5' });
    // The governed way to new ids (or a new host): the list written without the path, then
    // with it again — a path the list did not hold, reach regained and approver-governed —
    // adopts them.
    expect((await settings('docs', { code_repos: [{ path: 'immediately-run/site', repo_id: '10', owner_id: '5' }] })).status).toBe(200);
    expect((await settings('docs', { code_repos: [
      { path: 'acme/monorepo', repo_id: '8888', owner_id: '31' },
      { path: 'immediately-run/site', repo_id: '10', owner_id: '5' },
    ] })).status).toBe(200);
    expect(await rows('SELECT repo_id, owner_id FROM code_repos WHERE repository_id = ? AND path = ?', 'docs', 'acme/monorepo')).toEqual([{ repo_id: '8888', owner_id: '31' }]);
  });

  it('the human_identity knob is a short plain string or null, and diffing alone never enforces it', async () => {
    const bad = await policy('docs', { base_version: 1, policy: { ...COOPERATIVE, human_identity: '' } });
    expect(bad).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(bad.json.message).toContain('policy.human_identity');
    // A null human_identity is no change at all: the knob reads as none either way.
    expect((await policy('docs', { base_version: 1, policy: { ...COOPERATIVE, human_identity: null } })).json.changed).toEqual([]);
  });
});
