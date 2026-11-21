// S-BTN-192 approver lists (BATON_SPEC §12.8 R-BTN-188, R-BTN-185, §15; B-145): with
// `approvers.policy: [key:<A>]` and A a `human_only` key, an owner key B is forbidden and A
// accepted; A's change setting `approvers.policy: [key:<B>]` is accepted, after which A is
// forbidden and B — matching the list in force — accepted; a list naming a key that is no live
// owner is refused (`unsatisfiable-approvers`); revoking A while `[key:<A>]` is the only list
// it satisfies is refused; `human-gates` holds while every list is human-only and breaks once
// `approvers.policy` is `[key:<B>]` with B no human_only key. The scenario's MCP-key step (a
// delegated key is no approver) waits for B-124's MCP keys — none are registered yet; the PR
// body says so. Runs on both hosts.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { call as hostCall } from '#host';
import { keyCall, ORIGIN, rows, setAdminKeys, setClock, setHumanKeys, withCore } from '../helpers';
import { makeKey, sshsig, signedRequest, type TestKey } from '../lib/sshKeys';

const board = inject('board');
const T0 = Date.parse('2026-10-30T12:00:00Z');
let admin: TestKey;
let b: TestKey;
let a: TestKey;
let breakGlass: TestKey;

async function as(key: TestKey, path: string, body?: unknown, method?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created, method, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function sha256Of(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** The ops policy's current version and document. */
async function current() {
  const row = (await rows<{ version: number; policy_json: string }>('SELECT version, policy_json FROM repository_policies WHERE repository_id = ? ORDER BY version DESC LIMIT 1', 'ops'))[0];
  return { version: row.version, doc: JSON.parse(row.policy_json) };
}

/** Register `key` as a human-only key signed by `by`, and make it an owner of ops. */
async function humanOwner(key: TestKey, by: TestKey) {
  const blob = await sshsig(by, new TextEncoder().encode(key.publicKey.trim()), 'baton-human-keys@1');
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(by, ORIGIN + '/v1/human-keys', {
    created, method: 'POST', body: JSON.stringify({ public_key: key.publicKey, signature: btoa(String.fromCharCode(...blob)) }),
  }));
  expect(res.status).toBe(200);
  expect((await as(b, '/v1/owner/ops/owners', { public_key: key.publicKey })).status).toBe(200);
  expect((await rows<{ human_only: number }>('SELECT human_only FROM repository_owners WHERE fingerprint = ?', key.fingerprint))[0].human_only).toBe(1);
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  b = await makeKey('ssh-ed25519', 'b-owner');
  a = await makeKey('ssh-ed25519', 'a-human');
  breakGlass = await makeKey('ssh-ed25519', 'break-glass');
  await setAdminKeys(admin);
  await setHumanKeys(breakGlass);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', forge: 'github', remote: 'ssh://git@github.com/immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', sync_keys: [], owner_keys: [b.publicKey] })).status).toBe(200);
});

describe('S-BTN-192 approver lists', () => {
  it('the named key alone approves; the list in force decides what replaces it', async () => {
    // A is a human_only key and an owner; the list is [key:A].
    await humanOwner(a, breakGlass);
    const { version, doc } = await current();
    const withKeyA = { ...doc, approvers: { ...doc.approvers, policy: [`key:${a.fingerprint}`] } };
    const set = await as(a, '/v1/owner/ops/policy', { base_version: version, policy: withKeyA }, 'PUT');
    expect(set.status).toBe(200);
    // B (a plain owner) is forbidden; A is accepted.
    const { version: v2, doc: doc2 } = await current();
    const tweak = (d: typeof doc2) => ({ ...d, paths: { ...d.paths, protected: ['spec/**'] } });
    expect((await as(b, '/v1/owner/ops/policy', { base_version: v2, policy: tweak(doc2) }, 'PUT')).json.code).toBe('forbidden');
    const byA = await as(a, '/v1/owner/ops/policy', { base_version: v2, policy: tweak(doc2) }, 'PUT');
    expect(byA.status).toBe(200);

    // A's change setting approvers.policy to [key:B] is accepted; after it, A is forbidden and
    // B — matching the list in force — accepted.
    const { version: v3, doc: doc3 } = await current();
    const withKeyB = { ...doc3, approvers: { ...doc3.approvers, policy: [`key:${b.fingerprint}`] } };
    expect((await as(a, '/v1/owner/ops/policy', { base_version: v3, policy: withKeyB }, 'PUT')).status).toBe(200);
    const { version: v4, doc: doc4 } = await current();
    expect((await as(a, '/v1/owner/ops/policy', { base_version: v4, policy: tweak(doc4) }, 'PUT')).json.code).toBe('forbidden');
    expect((await as(b, '/v1/owner/ops/policy', { base_version: v4, policy: tweak(doc4) }, 'PUT')).status).toBe(200);

    // human-gates held while every list was human-only, and breaks at [key:B] (B is no
    // human_only key).
    const guarantees = (await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'policy-changed' ORDER BY seq`)).map((r) => JSON.parse(r.detail_json));
    expect(guarantees.length).toBeGreaterThanOrEqual(4);
    const read = await as(b, '/v1/repositories/ops/policy');
    expect(read.json.guarantees['human-gates']).toBe(false);
  });

  it('a list naming a key that is no live owner is refused; revoking the key it alone satisfies is refused', async () => {
    await humanOwner(a, breakGlass);
    const unknown = await makeKey('ssh-ed25519', 'not-an-owner');
    const { version, doc } = await current();
    // A list naming a revoked-or-unknown key does not count (R-BTN-188) — and a human-only one
    // with no live key to satisfy it is refused outright.
    const refused = await as(a, '/v1/owner/ops/policy', { base_version: version, policy: { ...doc, approvers: { ...doc.approvers, policy: [`key:${unknown.fingerprint}`] } } }, 'PUT');
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('unsatisfiable-approvers');
    expect(refused.json.list).toBe('approvers.policy');
    // With [key:A] in force, revoking A while it is the only list it satisfies is refused.
    expect((await as(a, '/v1/owner/ops/policy', { base_version: version, policy: { ...doc, approvers: { ...doc.approvers, policy: [`key:${a.fingerprint}`] } } }, 'PUT')).status).toBe(200);
    const revoke = await as(a, '/v1/human-keys', { fingerprint: a.fingerprint, revoke: true, confirm: true });
    expect(revoke.status).toBe(409);
    expect(revoke.json.code).toBe('unsatisfiable-approvers');
    expect(revoke.json.list).toBe('approvers.policy');
    // Once the list names B instead, the revocation goes through.
    const { version: v2, doc: doc2 } = await current();
    expect((await as(a, '/v1/owner/ops/policy', { base_version: v2, policy: { ...doc2, approvers: { ...doc2.approvers, policy: [`key:${b.fingerprint}`] } } }, 'PUT')).status).toBe(200);
    expect((await as(a, '/v1/human-keys', { fingerprint: a.fingerprint, revoke: true, confirm: true })).status).toBe(200);
    expect((await rows<{ removed_at: number | null }>('SELECT removed_at FROM repository_owners WHERE fingerprint = ?', a.fingerprint))[0].removed_at).not.toBeNull();
  });
});
