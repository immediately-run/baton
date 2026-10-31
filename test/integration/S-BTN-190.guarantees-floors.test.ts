// S-BTN-190 guarantees and floors (BATON_SPEC §12.8 R-BTN-189, R-BTN-180, §15; B-145): a
// floor naming four guarantees is registered and refuses a change that would break one
// (`floor-violated`); a floor naming a broken guarantee is refused, and a second floor with
// the same name conflicts; removal by an owner key is forbidden and by a human_only key
// accepted; a protection report that no longer matches raises `baton.unprotected`, breaks
// `no-runner-lands`, releases the untrusted runner's claim `released:floor`, refuses every
// claim `floor-broken` until a matching report, and stops trusted runners; a signed read
// replayed for another repository fails its signature, and one past `valid_until` is stale; a
// trusted runner whose policy pin differs acts on nothing, `baton.policy-unpinned` open until
// its pins match. The signature's verification side (a trusted runner pinned to the tenant
// key) is B-140's build; this scenario verifies the signature itself, as its runner would.
// Runs on both hosts.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { call as hostCall } from '#host';
import { cutover, keyCall, ORIGIN, payload, rows, setAdminKeys, setClock, setHumanKeys, syncCall, syncToken, withCore } from '../helpers';
import { makeKey, sshsig, signedRequest, type TestKey } from '../lib/sshKeys';
import { canonicalJson } from '../../src/core/policy';

const board = inject('board');
const T0 = Date.parse('2026-10-30T12:00:00Z');
let admin: TestKey;
let owner: TestKey;
let human: TestKey;
let breakGlass: TestKey;
let runnerKey: TestKey;
let checkerKey: TestKey;
const CHECKER_SECRET = 'checker-secret';

async function as(key: TestKey, path: string, body?: unknown, method?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created, method, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** The runner's heartbeat, with its policy pins. */
async function runnerBeat(secret: string | null, over: Record<string, unknown> = {}) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(runnerKey, ORIGIN + '/v1/runner/heartbeat', {
    created, ...(secret ? { headers: { 'X-Worker-Secret': secret } } : {}),
    body: JSON.stringify({ hostname: 'runner-host', session_name: 'runner', harness: 'opencode', kind: 'vm', billing: {}, capabilities: ['agent-venue'], tier_ceiling: 'critical', lease_timeout_s: 900, ...(secret ? {} : { secret_hash: await sha256Of('runner-secret') }), courses: [{ repository: 'ops', course: 'roadmap-pr', version: 3 }], ...over }),
  }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function checkerBeat(repository: string, matched: boolean, readingHash: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(checkerKey, ORIGIN + '/v1/runner/heartbeat', {
    created, headers: { 'X-Worker-Secret': CHECKER_SECRET },
    body: JSON.stringify({ hostname: 'checker-host', session_name: 'checker', harness: 'opencode', kind: 'vm', billing: {}, capabilities: [], tier_ceiling: 'critical', lease_timeout_s: 900, courses: [], protection: [{ repository, matched, reading_hash: readingHash }] }),
  }));
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, any>;
}

async function sha256Of(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The ops policy row's current version and document. */
async function current() {
  const row = (await rows<{ version: number; policy_json: string }>('SELECT version, policy_json FROM repository_policies WHERE repository_id = ? ORDER BY version DESC LIMIT 1', 'ops'))[0];
  return { version: row.version, doc: JSON.parse(row.policy_json) };
}

/** Set `ops` to the `protected-signed` preset, with a human owner and the checker in place. */
async function protectedSigned() {
  // The human key registers with the tenant (break-glass signs the first one, R-BTN-185), then
  // becomes an owner marked `human_only`.
  const blob = await sshsig(breakGlass, new TextEncoder().encode(human.publicKey.trim()), 'baton-human-keys@1');
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const registered = await hostCall(await signedRequest(breakGlass, ORIGIN + '/v1/human-keys', {
    created, method: 'POST', body: JSON.stringify({ public_key: human.publicKey, signature: btoa(String.fromCharCode(...blob)) }),
  }));
  expect(registered.status).toBe(200);
  await as(owner, '/v1/owner/ops/owners', { public_key: human.publicKey });
  // The break-glass key is an owner too — marked `human_only` like every key BATON_HUMAN_KEYS
  // lists — so it can act on the owner routes whose lists it alone satisfies under `hardware`.
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', owner_keys_add: [breakGlass.publicKey] })).status).toBe(200);
  await makeChecker();
  const { version } = await current();
  const out = await as(human, '/v1/owner/ops/policy', { base_version: version, preset: 'protected-signed' }, 'PUT');
  expect(out.status).toBe(200);
  return out;
}

async function makeChecker() {
  expect((await keyCall(owner, '/v1/owner/ops/grants', { public_key: checkerKey.publicKey, hostname: 'checker-host', capabilities: ['agent-venue'] })).status).toBe(200);
  await rows('UPDATE worker_grants SET role = ? WHERE credential_id = ? AND repository_id = ?', 'protection-checker', checkerKey.fingerprint, 'ops');
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  await hostCall(await signedRequest(checkerKey, ORIGIN + '/v1/runner/heartbeat', {
    created, body: JSON.stringify({ hostname: 'checker-host', session_name: 'checker', harness: 'opencode', kind: 'vm', billing: {}, capabilities: [], tier_ceiling: 'critical', lease_timeout_s: 900, secret_hash: await sha256Of(CHECKER_SECRET), courses: [] }),
  }));
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  human = await makeKey('ssh-ed25519', 'human');
  breakGlass = await makeKey('ssh-ed25519', 'break-glass');
  runnerKey = await makeKey('ssh-ed25519', 'runner');
  checkerKey = await makeKey('ssh-ed25519', 'checker');
  await setAdminKeys(admin);
  await setHumanKeys(breakGlass);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', forge: 'github', remote: 'ssh://git@github.com/immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', sync_keys: [], owner_keys: [owner.publicKey] })).status).toBe(200);
  const ops = await syncTokenFor('immediately-run/ops');
  await syncCall('/v1/sync/board', payload('f'.repeat(40), null, board.states.A), ops);
  await cutover(1, 'ops');
  await registerRunner();
});

/** A board refresh for ops, so a released ticket is claimable again. */
async function refreshOps() {
  await syncCall('/v1/sync/board', payload('f'.repeat(40), 'f'.repeat(40), board.states.A), await syncTokenFor('immediately-run/ops'));
}

/** An OIDC token for `ops`' own sync workflow, posting its board. */
function syncTokenFor(repository: string) {
  return syncToken({ repository, job_workflow_ref: `${repository}/.github/workflows/baton-sync.yml@refs/heads/main` });
}

/** Grant and register the untrusted runner, and give it a claim to lose. */
async function registerRunner() {
  expect((await keyCall(owner, '/v1/owner/ops/grants', { public_key: runnerKey.publicKey, hostname: 'runner-host', capabilities: ['agent-venue'] })).status).toBe(200);
  const first = await runnerBeat(null);
  expect(first.status).toBe(200);
  return first.json.worker_id as number;
}

describe('S-BTN-190 guarantees and floors', () => {
  it('a floor refuses a change that would break a guarantee it names; both bad floors refused; removal needs its remove_by', async () => {
    // A floor naming a broken guarantee is refused at once: under the cooperative policy
    // `no-runner-lands`'s policy conditions do not hold (the owner is the approver in force).
    const brokenEarly = await as(owner, '/v1/owner/ops/policy/floors', { name: 'early', guarantees: ['no-runner-lands'] });
    expect(brokenEarly.status).toBe(409);
    expect(brokenEarly.json.code).toBe('floor-violated');
    await protectedSigned();
    // The floor: Fieldhouse's four (R-FH-3's mode, named as the deployment knows them).
    // Under `protected-signed` (`human_key: hardware`), the human entries are met only by a
    // hardware key (B-136's build) or the break-glass one — the deployment's root of trust is
    // the human_only key that acts here (R-BTN-185).
    const floor = await as(breakGlass, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', guarantees: ['no-runner-lands', 'independent-review', 'signed-authorship', 'human-gates-hardware'] });
    expect(floor.status).toBe(200);
    // A change admitting runner to refs.default_branch (or refs.other) is refused floor-violated.
    const { version, doc } = await current();
    const admitRunner = (refs: string[]) => ({ ...doc, refs: { ...doc.refs, default_branch: refs } });
    for (const refs of [['runner', 'trusted-runner', 'human'], ['trusted-runner', 'human', 'runner']] as const) {
      const refused = await as(breakGlass, '/v1/owner/ops/policy', { base_version: version, policy: admitRunner([...refs]) }, 'PUT');
      expect(refused.status).toBe(409);
      expect(refused.json.code).toBe('floor-violated');
      expect(refused.json.floor).toBe('fieldhouse');
      expect(refused.json.guarantee).toBe('no-runner-lands');
    }
    // A second floor with the name conflicts (the floors are judged on the policy alone, so
    // the fieldhouse four hold without any report — R-BTN-189).
    const again = await as(breakGlass, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', guarantees: ['human-gates'] });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('conflict');
    // Removal: an owner key is refused (remove_by: human), a human_only key accepted.
    const byOwner = await as(owner, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', remove: true, confirm: true });
    expect(byOwner.status).toBe(403);
    const byHuman = await as(breakGlass, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', remove: true, confirm: true });
    expect(byHuman.status).toBe(200);
    expect((await rows('SELECT count(*) AS n FROM policy_floors WHERE repository_id = ? AND name = ?', 'ops', 'fieldhouse'))[0].n).toBe(0);
  });

  it('a report that no longer matches raises baton.unprotected, releases the claim released:floor, and refuses claims floor-broken until a matching report', async () => {
    await protectedSigned();
    await as(breakGlass, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', guarantees: ['no-runner-lands', 'independent-review', 'signed-authorship', 'human-gates-hardware'] });
    // A claim to lose: the runner holds one while the checker still reports a match.
    await checkerBeat('ops', true, 'reading-1');
    const claim = await claimAsRunner();
    expect(claim.json.ticket_id).toBe('ops:R3-9001');
    // The checker reports a mismatch: baton.unprotected opens, no-runner-lands breaks, the
    // running claim is sent a release with reason `floor` and ends `released:floor`, and every
    // further claim is refused `floor-broken`.
    await checkerBeat('ops', false, 'reading-2');
    expect((await rows(`SELECT count(*) AS n FROM policy_conditions WHERE repository_id = 'ops' AND type = 'baton.unprotected' AND closed_at IS NULL`))[0].n).toBe(1);
    const row = (await rows<{ status: string; end_reason: string }>('SELECT status, end_reason FROM claims WHERE id = ?', claim.json.claim_id))[0];
    expect(row.status).toBe('released');
    expect(row.end_reason).toBe('released:floor');
    expect((await rows(`SELECT count(*) AS n FROM messages WHERE kind = 'release' AND json_extract(payload_json, '$.reason') = 'floor'`))[0].n).toBe(1);
    const refused = await claimAsRunner();
    expect(refused.status).toBe(409);
    expect(refused.json.rule).toBe('floor');
    expect(refused.json.rule_code).toBe('floor-broken');
    // A matching report that repeats its reading closes the condition and unblocks the floor.
    await checkerBeat('ops', true, 'reading-2');
    expect((await rows(`SELECT count(*) AS n FROM policy_conditions WHERE repository_id = 'ops' AND type = 'baton.unprotected' AND closed_at IS NULL`))[0].n).toBe(0);
    await refreshOps();
    const again = await claimAsRunner();
    expect(again.json.ticket_id).toBe('ops:R3-9001');
  });

  it('a signed read replayed for another repository fails its signature; one past valid_until is stale', async () => {
    await protectedSigned();
    const read = await as(owner, '/v1/repositories/ops/policy');
    expect(read.status).toBe(200);
    expect(await verifyRead(read.json)).toBe(true);
    // Replayed for another repository: the signature no longer covers the fields.
    expect(await verifyRead({ ...read.json, repository: 'docs' })).toBe(false);
    expect(await verifyRead({ ...read.json, policy: { ...read.json.policy, human_key: 'any' } })).toBe(false);
    // Past valid_until: the read is stale, whatever its signature.
    expect(read.json.valid_until).toBeGreaterThan(T0);
    const stale = { ...read.json, at: T0 - 20 * 60_000, valid_until: T0 - 10 * 60_000 };
    expect(stale.valid_until < T0).toBe(true);
    expect(await verifyRead(stale)).toBe(false);
  });

  it('a trusted runner whose pin differs acts on nothing, baton.policy-unpinned open until its pins match', async () => {
    await protectedSigned();
    const { hash } = (await rows<{ hash: string }>('SELECT hash FROM repository_policies WHERE repository_id = ? ORDER BY version DESC LIMIT 1', 'ops'))[0];
    // A pin of the wrong hash: stored, the condition opens, and the runner acts on nothing.
    await runnerBeat('runner-secret', { policy_pins: [{ repository: 'ops', hash: 'e'.repeat(64) }] });
    expect((await rows(`SELECT count(*) AS n FROM policy_conditions WHERE repository_id = 'ops' AND type = 'baton.policy-unpinned' AND closed_at IS NULL`))[0].n).toBe(1);
    const refused = await claimAsRunner();
    expect(refused.status).toBe(409);
    expect(refused.json.rule_code).toBe('policy-unpinned');
    // A matching pin closes the condition and the runner acts again.
    await runnerBeat('runner-secret', { policy_pins: [{ repository: 'ops', hash }] });
    expect((await rows(`SELECT count(*) AS n FROM policy_conditions WHERE repository_id = 'ops' AND type = 'baton.policy-unpinned' AND closed_at IS NULL`))[0].n).toBe(0);
    await refreshOps();
    const claim = await claimAsRunner();
    expect(claim.json.ticket_id).toBe('ops:R3-9001');
    expect(claim.json.policy_hash).toBe(hash);
  });
});

/** The runner claims whatever ops offers. */
async function claimAsRunner() {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(runnerKey, ORIGIN + '/v1/runner/claim', {
    created, method: 'POST', headers: { 'X-Worker-Secret': 'runner-secret' }, body: JSON.stringify({ request_id: `req-${Math.random().toString(16).slice(2)}` }),
  }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** Verify a signed policy read (R-BTN-189): Ed25519 by the tenant's key over `baton-policy@1\n`
 *  and the canonical JSON of the other fields, and not yet past valid_until. */
async function verifyRead(read: Record<string, any>): Promise<boolean> {
  const jwk = JSON.parse((await rows<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'policy_signing_key'`))[0].value) as JsonWebKey;
  const pub = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, { name: 'Ed25519' }, false, ['verify']);
  const { repository, tenant, version, hash, policy, guarantees, guarantees_hash, floors, floors_hash, at, valid_until, signature } = read;
  const sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  if (!(await crypto.subtle.verify({ name: 'Ed25519' }, pub, sig, new TextEncoder().encode(`baton-policy@1\n${canonicalJson({ repository, tenant, version, hash, policy, guarantees, guarantees_hash, floors, floors_hash, at, valid_until })}`)))) return false;
  return valid_until > (await withCore((c) => c.now()));
}
