// S-BTN-189 the repository policy (BATON_SPEC §12.8 R-BTN-188/R-BTN-189, §15; B-145): a new
// repository's version 1 is the cooperative column; a new git repository's is plain-git, and
// `protected` applied to one writes plain-git's three values with it; the protected preset
// applied by an owner key holding no human_only key is refused (its human-only approver lists
// would have no live credential), by one with a human_only key stored — without the preset's
// name in the document; every guarantee but signed-authorship and human-gates-hardware holds
// except no-runner-lands, which holds once the protection checker reports a match; the owner
// key's policy changes are forbidden both ways under approvers.policy: [human], the human
// key's accepted and logged with `changed`; two owners setting from one base_version: the
// second conflict; setting approvers.trust: [human] clears every owner-set trust level to
// untrusted, drops roles and nulls domains. The scenario's MCP-key steps (a delegated key
// changes no policy) wait for B-124's MCP keys, and its export-and-import step for R-BTN-88's
// export — nothing of either is in the code yet; the PR body says so. Runs on both hosts.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { call as hostCall } from '#host';
import { cutover, course, keyCall, ORIGIN, payload, rows, setAdminKeys, setClock, setHumanKeys, setPolicySigningKey, syncCall, withCore } from '../helpers';
import { makeKey, sshsig, signedRequest, type TestKey } from '../lib/sshKeys';
import { COOPERATIVE, PLAIN_GIT, canonicalJson } from '../../src/core/policy';

const board = inject('board');
const T0 = Date.parse('2026-10-30T12:00:00Z');
let admin: TestKey;
let owner: TestKey;
let human: TestKey;
let breakGlass: TestKey;
let checkerKey: TestKey;
/** The tenant's Ed25519 key this test configured (BATON_SIGNING_KEY) — what a pinned reader holds. */
let signingJwk: JsonWebKey;

/** A signed call by an arbitrary key (the human one among them). */
async function as(key: TestKey, path: string, body?: unknown, method?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created, method, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** The repository's current policy row, as the store holds it. */
async function policyRow(repository: string) {
  return (await rows<{ version: number; hash: string; previous_hash: string | null; changed_by: string; approver: string | null; preset: string | null; policy_json: string }>(
    'SELECT version, hash, previous_hash, changed_by, approver, preset, policy_json FROM repository_policies WHERE repository_id = ? ORDER BY version DESC LIMIT 1', repository))[0];
}

/** The signed read of a repository's policy, verified: the signature covers the exact fields. */
async function signedRead(repository: string, key: TestKey) {
  return as(key, `/v1/repositories/${repository}/policy`);
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  human = await makeKey('ssh-ed25519', 'human');
  breakGlass = await makeKey('ssh-ed25519', 'break-glass');
  checkerKey = await makeKey('ssh-ed25519', 'checker');
  await setAdminKeys(admin);
  signingJwk = await setPolicySigningKey();
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', forge: 'github', remote: 'ssh://git@github.com/immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', sync_keys: [] , owner_keys: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A));
  await cutover(1, 'docs');
  await cutover(1, 'ops');
});

describe('S-BTN-189 the repository policy', () => {
  it('a new repository gets version 1, the cooperative column, in the same transaction', async () => {
    const row = await policyRow('ops');
    expect(row.version).toBe(1);
    expect(row.preset).toBe('cooperative');
    expect(row.changed_by).toBe('server');
    expect(JSON.parse(row.policy_json)).toEqual(COOPERATIVE);
    expect(row.previous_hash).toBeNull();
  });

  it('a new git repository gets the plain-git values, and protected applied to it folds them in', async () => {
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'plain', github: 'server/plain', forge: 'git', remote: 'ssh://git@git.example/plain.git', default_branch: 'main', sync_keys: [{ public_key: checkerKey.publicKey, role: 'sync' }], owner_keys: [owner.publicKey] })).status).toBe(200);
    const seeded = await policyRow('plain');
    expect(seeded.preset).toBe('plain-git');
    expect(JSON.parse(seeded.policy_json)).toEqual(PLAIN_GIT);
    // The human-only lists need a live human key before `protected` lands (unsatisfiable-approvers).
    expect((await as(owner, '/v1/owner/plain/policy', { base_version: 1, preset: 'protected' }, 'PUT')).json.code).toBe('unsatisfiable-approvers');
    await addHumanOwner('plain');
    const applied = await as(owner, '/v1/owner/plain/policy', { base_version: 1, preset: 'protected' }, 'PUT');
    expect(applied.status).toBe(200);
    const doc = JSON.parse((await policyRow('plain')).policy_json);
    expect(doc.leg_state).toBe('branch');
    expect(doc.inputs.board).toEqual(['sync-key']);
    expect(doc.outbox['forge-check'].deliverers).toEqual([]);
    expect(doc.approvers.policy).toEqual(['human']);
    // The stored document never names a preset: no `preset` field, no preset's name as a value
    // (the `paths.protected` knob's own name aside), and only the change log's column has one.
    expect(Object.keys(doc)).not.toContain('preset');
    expect(JSON.stringify(doc)).not.toContain('"plain-git"');
    expect(JSON.stringify(doc)).not.toContain('"cooperative"');
    expect((await rows<{ preset: string | null }>('SELECT preset FROM repository_policies WHERE repository_id = ? ORDER BY version DESC LIMIT 1', 'plain'))[0].preset).toBe('protected');
  });

  it('protected applied without a human_only key is refused; with one, every guarantee but three holds once the checker reports', async () => {
    // No human key yet: the preset's human-only approver lists would open a gate no live
    // credential can satisfy (R-BTN-188).
    const refused = await as(owner, '/v1/owner/ops/policy', { base_version: 1, preset: 'protected' }, 'PUT');
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('unsatisfiable-approvers');
    expect(refused.json.list).toBe('approvers.members');
    // Round 1, finding 2: break-glass configured alone still refuses — R-BTN-188's no-gate rule
    // needs a `human_only` key among the repository's OWNERS, and the host's root of trust acts,
    // it does not count as one.
    await setHumanKeys(breakGlass);
    expect((await as(owner, '/v1/owner/ops/policy', { base_version: 1, preset: 'protected' }, 'PUT')).json.code).toBe('unsatisfiable-approvers');
    await addHumanOwner('ops');
    // `protected-signed` (human_key: hardware) is refused while no owner's key meets hardware —
    // no FIDO attestation exists before B-136 (finding 2's other half).
    expect((await as(owner, '/v1/owner/ops/policy', { base_version: 1, preset: 'protected-signed' }, 'PUT')).json.code).toBe('unsatisfiable-approvers');
    // The protection checker's grant, made while the policy still admits owners (a grant is an
    // `approvers.members` action; under `protected` only a human key makes one).
    await makeChecker('ops');
    const applied = await as(human, '/v1/owner/ops/policy', { base_version: 1, preset: 'protected' }, 'PUT');
    expect(applied.status).toBe(200);
    expect(applied.json.changed).toContain('approvers.policy');
    // Before any protection report: every guarantee but signed-authorship and
    // human-gates-hardware holds EXCEPT no-runner-lands and every guarantee including it.
    expect(applied.json.guarantees['no-runner-lands']).toBe(false);
    for (const g of ['control-paths-human', 'tickets-approved', 'independent-review', 'signed-authorship', 'board-from-trusted', 'human-gates-hardware']) {
      expect(applied.json.guarantees[g], g).toBe(false);
    }
    for (const g of ['trusted-domain-separate', 'human-gates']) {
      expect(applied.json.guarantees[g], g).toBe(true);
    }

    // The signed read carries every field R-BTN-189 binds, and its Ed25519 signature covers
    // exactly them: baton-policy@1 over the canonical JSON of the rest.
    const read = await signedRead('ops', owner);
    expect(read.status).toBe(200);
    expect(read.json.repository).toBe('ops');
    expect(read.json.tenant).toBeTruthy();
    expect(read.json.version).toBe(2);
    expect(read.json.guarantees['no-runner-lands']).toBe(false);
    expect(read.json.valid_until).toBe(read.json.at + 10 * 60_000);
    expect(await verifyRead(read.json)).toBe(true);
    const tampered = { ...read.json, repository: 'docs' };
    expect(await verifyRead(tampered)).toBe(false);

    // no-runner-lands holds only once the protection checker reports a match (R-BTN-180).
    await checkerBeat('ops', true, 'r1');
    const after = await signedRead('ops', owner);
    expect(after.json.guarantees['no-runner-lands']).toBe(true);
    expect(after.json.guarantees['control-paths-human']).toBe(true);
    expect(after.json.guarantees['tickets-approved']).toBe(true);
  });

  it('policy changes under approvers.policy: [human]: the owner key forbidden both ways, the human key accepted and logged', async () => {
    await addHumanOwner('ops');
    expect((await as(owner, '/v1/owner/ops/policy', { base_version: 1, preset: 'protected' }, 'PUT')).status).toBe(200);
    // Round 1, finding 4: an administrator's owner_keys_add and sync_keys_add are
    // `approvers.members` actions too — a human-only list is a human gate for administrators
    // (R-BTN-188, ticket item 12), and an administrator key opens no human gate.
    const extra = await makeKey('ssh-ed25519', 'extra-owner');
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', owner_keys_add: [extra.publicKey] })).json.code).toBe('forbidden');
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', sync_keys_add: [{ public_key: extra.publicKey, role: 'sync' }] })).json.code).toBe('forbidden');
    // Round 1, finding 13: loosening an R-BTN-66 setting needs approvers.policy (R-BTN-186
    // names `retry` flatly); the human key's change is accepted.
    expect((await as(owner, '/v1/owner/ops/settings', { retry: { backoff_ms: [3_600_000], max_failed: 3 } }, 'PUT')).json.code).toBe('forbidden');
    expect((await as(human, '/v1/owner/ops/settings', { retry: { backoff_ms: [3_600_000], max_failed: 3 } }, 'PUT')).status).toBe(200);
    // Round 1, finding 3: revoking the last human owner under `protected` would leave every
    // human list with no live credential (R-BTN-188: naming the list) — the replacement is
    // added first, then the old key revoked.
    expect((await as(human, '/v1/human-keys', { fingerprint: human.fingerprint, revoke: true, confirm: true })).json.code).toBe('unsatisfiable-approvers');
    const base = (await policyRow('ops')).version;
    const current = JSON.parse((await policyRow('ops')).policy_json);
    const raised = { ...current, merge: { ...current.merge, reviews: { count: 3, distinct: current.merge.reviews.distinct } } };
    const lowered = { ...current, merge: { ...current.merge, reviews: { count: 1, distinct: current.merge.reviews.distinct } } };
    expect((await as(owner, '/v1/owner/ops/policy', { base_version: base, policy: raised }, 'PUT')).json.code).toBe('forbidden');
    expect((await as(owner, '/v1/owner/ops/policy', { base_version: base, policy: lowered }, 'PUT')).json.code).toBe('forbidden');
    const set = await as(human, '/v1/owner/ops/policy', { base_version: base, policy: raised }, 'PUT');
    expect(set.status).toBe(200);
    expect(set.json.changed).toEqual(['merge.reviews']);
    const events = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'policy-changed' AND json_extract(detail_json, '$.repository') = 'ops'`);
    expect(events.length).toBeGreaterThan(0);
    const detail = JSON.parse(events[events.length - 1].detail_json);
    expect(detail.from).toBe(base);
    expect(detail.to).toBe(base + 1);
    expect(detail.changed).toEqual(['merge.reviews']);
    // The log route lists the versions with their changes.
    const log = await as(owner, '/v1/owner/ops/policy/log');
    expect(log.status).toBe(200);
    expect(log.json.versions.at(-1).changed).toEqual(['merge.reviews']);
    const after = await as(owner, '/v1/owner/ops/policy/log?after=' + base);
    expect(after.json.versions.map((v: { version: number }) => v.version)).toEqual([base + 1]);
  });

  it('two owners setting from one base_version: the second is a conflict', async () => {
    await addHumanOwner('ops');
    const other = await makeKey('ssh-ed25519', 'other-human');
    await registerHuman(other, human);
    expect((await as(owner, '/v1/owner/ops/owners', { public_key: other.publicKey })).status).toBe(200);
    const a = await as(human, '/v1/owner/ops/policy', { base_version: 1, preset: 'protected' }, 'PUT');
    expect(a.status).toBe(200);
    const current = JSON.parse((await policyRow('ops')).policy_json);
    const first = await as(other, '/v1/owner/ops/policy', { base_version: 2, policy: { ...current, paths: { ...current.paths, protected: ['spec/**'] } } }, 'PUT');
    expect(first.status).toBe(200);
    const second = await as(human, '/v1/owner/ops/policy', { base_version: 2, policy: current }, 'PUT');
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('conflict');
  });

  it('setting approvers.trust: [human] clears every owner-set trust level, drops roles, nulls domains', async () => {
    // A courier with owner-set trust on the repository (B-145 item 10: set by the
    // approvers.trust approver).
    expect((await as(owner, '/v1/owner/ops/couriers', { public_key: checkerKey.publicKey, asks: ['owner'], trust_level: 'trusted', trust_domain: 'host-a' })).status).toBe(200);
    const before = (await rows<{ trust_level: string; trust_domain: string; trust_set_by: string }>('SELECT trust_level, trust_domain, trust_set_by FROM couriers WHERE repository_id = ? LIMIT 1', 'ops'))[0];
    expect(before.trust_level).toBe('trusted');
    expect(before.trust_domain).toBe('host-a');
    expect(before.trust_set_by).toBe(`owner:${owner.fingerprint}`);
    // From cooperative, an owner key sets approvers.trust: [human] — accepted, with every
    // owner-set trust cleared to untrusted, roles dropped, domains and families null.
    await addHumanOwner('ops');
    const current = JSON.parse((await policyRow('ops')).policy_json);
    const set = await as(owner, '/v1/owner/ops/policy', { base_version: (await policyRow('ops')).version, policy: { ...current, approvers: { ...current.approvers, trust: ['human'] } } }, 'PUT');
    expect(set.status).toBe(200);
    const after = (await rows<{ trust_level: string; trust_domain: string | null }>('SELECT trust_level, trust_domain FROM couriers WHERE repository_id = ? LIMIT 1', 'ops'))[0];
    expect(after.trust_level).toBe('untrusted');
    expect(after.trust_domain).toBeNull();
    expect((await rows(`SELECT detail_json FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'policy-trust-cleared'`)).length).toBe(1);
  });

  it('a claim response carries the policy hashes and leg_state of its repository', async () => {
    const w = await makeKey('ssh-ed25519', 'w');
    expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: w.publicKey, hostname: 'w-host', capabilities: ['agent-venue'] })).status).toBe(200);
    const secret = 'secret-w';
    const created = Math.floor((await withCore((c) => c.now())) / 1000);
    const hb = await hostCall(await signedRequest(w, ORIGIN + '/v1/runner/heartbeat', {
      created, body: JSON.stringify({ hostname: 'w-host', session_name: 'w', harness: 'opencode', kind: 'vm', billing: {}, capabilities: ['agent-venue'], tier_ceiling: 'critical', lease_timeout_s: 900, secret_hash: await sha256Of(secret), courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] }),
    }));
    expect(hb.status).toBe(200);
    const hbJson = (await hb.json()) as Record<string, any>;
    expect(hbJson.policies.docs.version).toBe(1);
    expect(hbJson.policies.docs.policy_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hbJson.policies.docs.guarantees_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hbJson.policies.docs.floors_hash).toMatch(/^[0-9a-f]{64}$/);
    const claim = await hostCall(await signedRequest(w, ORIGIN + '/v1/runner/claim', {
      created, method: 'POST', headers: { 'X-Worker-Secret': secret }, body: JSON.stringify({ request_id: 'req-s189-1' }),
    }));
    const claimJson = (await claim.json()) as Record<string, any>;
    expect(claimJson.policy_hash).toBe(hbJson.policies.docs.policy_hash);
    expect(claimJson.guarantees_hash).toBe(hbJson.policies.docs.guarantees_hash);
    expect(claimJson.floors_hash).toBe(hbJson.policies.docs.floors_hash);
    expect(claimJson.leg_state).toBe('forge');
  });

  it('a policy live grants already break is refused — one grant per domain, a trusted domain shared with none', async () => {
    // Two runner grants in one trust domain, one marked trusted and one not (B-147's trust
    // routes are not built: the rows are written as their approver would write them).
    const r1 = await makeKey('ssh-ed25519', 'runner-1');
    const r2 = await makeKey('ssh-ed25519', 'runner-2');
    for (const [k, host] of [[r1, 'runner-1-host'], [r2, 'runner-2-host']] as const) {
      expect((await keyCall(owner, `/v1/owner/ops/grants`, { public_key: k.publicKey, hostname: host, capabilities: ['agent-venue'] })).status).toBe(200);
    }
    await rows(`UPDATE worker_grants SET trust_level = 'trusted', trust_domain = 'host-a' WHERE credential_id = ?`, r1.fingerprint);
    await rows(`UPDATE worker_grants SET trust_level = 'untrusted', trust_domain = 'host-a' WHERE credential_id = ?`, r2.fingerprint);
    const { version, doc } = await policyRow('ops').then((r) => ({ version: r.version, doc: JSON.parse(r.policy_json) }));
    // grants.trusted_domain: separate — the trusted grant's domain is shared with another grant,
    // untrusted included (round 1, finding 6: the untrusted one was skipped before).
    const separate = await as(owner, '/v1/owner/ops/policy', { base_version: version, policy: { ...doc, grants: { ...doc.grants, trusted_domain: 'separate' } } }, 'PUT');
    expect(separate.status).toBe(400);
    expect(separate.json.message).toContain('grant:');
    // grants.one_per_domain with separate — at most one ACTIVE grant per domain, whatever the
    // trust of either.
    const both = await as(owner, '/v1/owner/ops/policy', { base_version: version, policy: { ...doc, grants: { ...doc.grants, one_per_domain: true, trusted_domain: 'separate' } } }, 'PUT');
    expect(both.json.message).toContain('grant:');
    // The second grant gone, a courier in a domain of its own — registered once per ask, two
    // rows — does not refuse the change against itself: a courier is not a grant, and one
    // courier is one courier.
    await rows(`UPDATE worker_grants SET revoked_at = ? WHERE credential_id = ?`, Date.now(), r2.fingerprint);
    const courier = await makeKey('ssh-ed25519', 'courier');
    expect((await as(owner, '/v1/owner/ops/couriers', { public_key: courier.publicKey, asks: ['owner', 'hi'], trust_level: 'untrusted', trust_domain: 'host-b' })).status).toBe(200);
    const ok = await as(owner, '/v1/owner/ops/policy', { base_version: version, policy: { ...doc, grants: { ...doc.grants, one_per_domain: true, trusted_domain: 'separate' } } }, 'PUT');
    expect(ok.status).toBe(200);
  });

  it('a service: writer that gained a role holds the course at its previous version — the check runs again at every snapshot', async () => {
    // A neutral service key the policy names for std:checks@1 (the trusted executor's, B-136).
    const service = await makeKey('ssh-ed25519', 'service');
    const row = await policyRow('docs');
    const doc = JSON.parse(row.policy_json);
    const withService = { ...doc, attestations: { ...doc.attestations, 'std:checks@1': [`service:${service.fingerprint}`] } };
    expect((await as(owner, '/v1/owner/docs/policy', { base_version: row.version, policy: withService }, 'PUT')).status).toBe(200);
    // The key becomes a runner (a grant is an approvers.members action): the policy document did
    // not change, but its service: writer is no longer neutral — and the next snapshot holds the
    // course at its previous version, naming the drift (R-BTN-181, B-145 item 2).
    expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: service.publicKey, hostname: 'service-host', capabilities: ['agent-venue'] })).status).toBe(200);
    const posted = await syncCall('/v1/sync/board', payload('e'.repeat(40), board.shas.A, board.states.A, { registry: [course(4)] }));
    const postedJson = (await (posted as Response).json()) as Record<string, any>;
    expect(postedJson.courses_refused).toEqual(['roadmap-pr']);
    expect((await rows<{ version: number }>('SELECT version FROM courses WHERE repository_id = ? AND id = ?', 'docs', 'roadmap-pr'))[0].version).toBe(3);
  });

  it('version 1 of the log changes nothing — a git repository’s plain-git seed is not a change from cooperative', async () => {
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'plain2', github: 'server/plain2', forge: 'git', remote: 'ssh://git@git.example/plain2.git', default_branch: 'main', sync_keys: [{ public_key: checkerKey.publicKey, role: 'sync' }], owner_keys: [owner.publicKey] })).status).toBe(200);
    const log = await as(owner, '/v1/owner/plain2/policy/log');
    expect(log.status).toBe(200);
    expect(log.json.versions).toHaveLength(1);
    expect(log.json.versions[0].changed).toEqual([]);
  });
});

// ── the scenario's own helpers ───────────────────────────────────────────────────────────

async function sha256Of(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Register `key` as a human-only key, signed by `by` (a live human_only key: the break-glass
 *  one signs the first, any human key the later ones — R-BTN-185). */
async function registerHuman(key: TestKey, by: TestKey) {
  const blob = await sshsig(by, new TextEncoder().encode(key.publicKey.trim()), 'baton-human-keys@1');
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(by, ORIGIN + '/v1/human-keys', {
    created, method: 'POST', body: JSON.stringify({ public_key: key.publicKey, signature: btoa(String.fromCharCode(...blob)) }),
  }));
  expect(res.status).toBe(200);
}

/** Register the scenario's human key (by break-glass) and add it as an owner, marked
 *  `human_only` — registering a human key with the tenant owns nothing until an
 *  `approvers.members` action adds it. The host's BATON_HUMAN_KEYS comes with the first human
 *  key (a tenant's first is a line of it, R-BTN-185): the scenario configures it here, after
 *  showing what a repository without one refuses. */
async function addHumanOwner(repository: string) {
  await setHumanKeys(breakGlass);
  await registerHuman(human, breakGlass);
  expect((await rows<{ n: number }>('SELECT count(*) AS n FROM repository_owners WHERE fingerprint = ? AND human_only = 0', human.fingerprint))[0].n).toBe(0);
  expect((await as(owner, `/v1/owner/${repository}/owners`, { public_key: human.publicKey })).status).toBe(200);
  expect((await rows<{ human_only: number }>('SELECT human_only FROM repository_owners WHERE fingerprint = ?', human.fingerprint))[0].human_only).toBe(1);
}

/** Make `checkerKey` the repository's protection checker: a grant with the checker role
 *  (R-BTN-180 — the role's own routes are B-147's, so the scenario writes it as its grant). */
async function makeChecker(repository: string) {
  expect((await keyCall(owner, `/v1/owner/${repository}/grants`, { public_key: checkerKey.publicKey, hostname: 'checker-host', capabilities: ['agent-venue'] })).status).toBe(200);
  await rows('UPDATE worker_grants SET role = ? WHERE credential_id = ? AND repository_id = ?', 'protection-checker', checkerKey.fingerprint, repository);
}

/** The checker's heartbeat, carrying its protection report. */
async function checkerBeat(repository: string, matched: boolean, readingHash: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(checkerKey, ORIGIN + '/v1/runner/heartbeat', {
    created, body: JSON.stringify({ hostname: 'checker-host', session_name: 'checker', harness: 'opencode', kind: 'vm', billing: {}, capabilities: [], tier_ceiling: 'critical', lease_timeout_s: 900, secret_hash: await sha256Of('checker-secret'), courses: [], protection: [{ repository, matched, reading_hash: readingHash }] }),
  }));
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, any>;
}

/** Verify a signed policy read as a trusted runner does (R-BTN-189): Ed25519 by the tenant's
 *  signing key over `baton-policy@1\n` and the canonical JSON of the other fields — the key the
 *  test configured as BATON_SIGNING_KEY, a reader's pinned tenant key, never one the read
 *  carries. */
async function verifyRead(read: Record<string, any>): Promise<boolean> {
  const pub = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: signingJwk.x }, { name: 'Ed25519' }, false, ['verify']);
  const { repository, tenant, version, hash, policy, guarantees, guarantees_hash, floors, floors_hash, at, valid_until, kid, signature } = read;
  const fields = { repository, tenant, version, hash, policy, guarantees, guarantees_hash, floors, floors_hash, at, valid_until };
  // The canonical JSON of the fields is what was signed — key order independent.
  const sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  if (!(await crypto.subtle.verify({ name: 'Ed25519' }, pub, sig, new TextEncoder().encode(`baton-policy@1\n${canonicalJson(fields)}`)))) return false;
  return kid === (await sha256Of(String(signingJwk.x)));
}
