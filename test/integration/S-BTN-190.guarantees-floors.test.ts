// S-BTN-190 guarantees and floors (BATON_SPEC §12.8 R-BTN-189, R-BTN-180, §15; B-145): a
// floor naming four guarantees is registered and refuses a change that would break one
// (`floor-violated`); a floor naming a broken guarantee is refused, and a second floor with
// the same name conflicts; removal by an owner key is forbidden and by a human_only key
// accepted; a protection report that no longer matches — or lapses past its 24 hours — raises
// `baton.unprotected`, breaks `no-runner-lands`, releases the untrusted runner's claim
// `released:floor`, refuses every claim `floor-broken` until a matching report (one restoring
// the forge closes it at once; a reading that changes while matching raises it again), and
// stops trusted runners. Policy reads are unsigned and runner pins no longer gate claims.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { call as hostCall } from '#host';
import { cutover, keyCall, ORIGIN, payload, rows, setAdminKeys, setClock, setHumanKeys, syncCall, syncToken, tick, withCore } from '../helpers';
import { makeKey, sshsig, signedRequest, type TestKey } from '../lib/sshKeys';

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

/** The runner's heartbeat. */
async function runnerBeat(secret: string | null, over: Record<string, unknown> = {}) {
  return runnerBeatAs('runner', 'runner-secret', over);
}

/** The runner sessions that already established their secret. */
const runnerSessions = new Set<string>();

/** A runner heartbeat under `session` (a fresh runner of the same credential), establishing
 *  its own secret on the first beat. */
async function runnerBeatAs(session: string, secret: string, over: Record<string, unknown> = {}) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const known = runnerSessions.has(session);
  const res = await hostCall(await signedRequest(runnerKey, ORIGIN + '/v1/runner/heartbeat', {
    created, ...(known ? { headers: { 'X-Runner-Secret': secret } } : {}),
    body: JSON.stringify({ hostname: 'runner-host', session_name: session, harness: 'opencode', kind: 'vm', billing: {}, capabilities: ['agent-venue'], tier_ceiling: 'critical', lease_timeout_s: 900, ...(known ? {} : { secret_hash: await sha256Of(secret) }), courses: [{ repository: 'ops', course: 'roadmap-pr', version: 3 }], ...over }),
  }));
  if (res.status === 200) runnerSessions.add(session);
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function checkerBeat(repository: string, matched: boolean, readingHash: string) {
  return checkerBeatAs('checker', CHECKER_SECRET, repository, matched, readingHash);
}

/** The checker sessions that already established their secret. */
const checkerSessions = new Set<string>();

/** A checker heartbeat under `session`, establishing its own secret on the first beat. */
async function checkerBeatAs(session: string, secret: string, repository: string, matched: boolean, readingHash: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  // `legs` is the heartbeat member §14 defines (R-BTN-190): B-140's checker sends it, so the
  // report carries it (round 1, finding 15).
  const res = await hostCall(await signedRequest(checkerKey, ORIGIN + '/v1/runner/heartbeat', {
    created, ...(checkerSessions.has(session) ? { headers: { 'X-Runner-Secret': secret } } : {}),
    body: JSON.stringify({ hostname: 'checker-host', session_name: session, harness: 'opencode', kind: 'vm', billing: {}, capabilities: [], tier_ceiling: 'critical', lease_timeout_s: 900, ...(checkerSessions.has(session) ? {} : { secret_hash: await sha256Of(secret) }), courses: [], protection: [{ repository, matched, reading_hash: readingHash, legs: { count: 2, tickets: 5 } }] }),
  }));
  if (res.status === 200) checkerSessions.add(session);
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
  // R-BTN-188 (round 1, finding 2): `protected-signed`'s `human_key: hardware` needs an owner
  // whose key MEETS hardware — a FIDO attestation. B-136's attestation routes are not built, so
  // the scenario writes the column as its check would (the way it writes the checker's role);
  // without it the apply is refused `unsatisfiable-approvers`.
  await rows('UPDATE repository_owners SET fido_attestation = ? WHERE fingerprint = ?', 'att:human-key-1', human.fingerprint);
  await makeChecker();
  const { version } = await current();
  const out = await as(human, '/v1/owner/ops/policy', { base_version: version, preset: 'protected-signed' }, 'PUT');
  expect(out.status).toBe(200);
  return out;
}

async function makeChecker() {
  expect((await keyCall(owner, '/v1/owner/ops/grants', { public_key: checkerKey.publicKey, hostname: 'checker-host', capabilities: ['agent-venue'] })).status).toBe(200);
  await rows('UPDATE runner_grants SET role = ? WHERE credential_id = ? AND repository_id = ?', 'protection-checker', checkerKey.fingerprint, 'ops');
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  await hostCall(await signedRequest(checkerKey, ORIGIN + '/v1/runner/heartbeat', {
    created, body: JSON.stringify({ hostname: 'checker-host', session_name: 'checker', harness: 'opencode', kind: 'vm', billing: {}, capabilities: [], tier_ceiling: 'critical', lease_timeout_s: 900, secret_hash: await sha256Of(CHECKER_SECRET), courses: [] }),
  }));
  checkerSessions.add('checker');
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
  runnerSessions.clear();
  checkerSessions.clear();
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
  const first = await runnerBeatAs('runner', 'runner-secret');
  expect(first.status).toBe(200);
  return first.json.runner_id as number;
}

describe('S-BTN-190 guarantees and floors', () => {
  it.each(['any', 'hardware'] as const)('applies human_key: %s to break-glass floor removal', async (human_key) => {
    const { version, doc } = await current();
    const policy = {
      ...doc, human_key, approvers: { ...doc.approvers, policy: ['owner', 'human'], members: ['owner', 'human'] },
      grants: { ...doc.grants, default_trust: 'untrusted', trusted_domain: 'separate' },
    };
    expect((await as(owner, '/v1/owner/ops/policy', { base_version: version, policy }, 'PUT')).status).toBe(200);
    const path = '/v1/owner/ops/policy/floors';
    expect((await as(owner, path, { name: 'custody', guarantees: ['trusted-domain-separate'], remove_by: 'human' })).status).toBe(200);
    const res = await as(breakGlass, path, { name: 'custody', remove: true, confirm: true });
    expect(res.status).toBe(human_key === 'any' ? 200 : 403);
    if (human_key === 'hardware') expect(res.json.code).toBe('forbidden');
    expect(await rows('SELECT name FROM policy_floors WHERE repository_id = ?', 'ops')).toEqual(human_key === 'any' ? [] : [{ name: 'custody' }]);
  });

  it('a floor refuses a change that would break a guarantee it names; both bad floors refused; removal needs its remove_by', async () => {
    // A floor naming a broken guarantee is refused at once: under the cooperative policy
    // `no-runner-lands`'s policy conditions do not hold (the owner is the approver in force).
    const brokenEarly = await as(owner, '/v1/owner/ops/policy/floors', { name: 'early', guarantees: ['no-runner-lands'] });
    expect(brokenEarly.status).toBe(409);
    expect(brokenEarly.json.code).toBe('floor-violated');
    await protectedSigned();
    // The floor: Fieldhouse's four (R-FH-3's mode, named as the deployment knows them).
    // The attested human owner meets the hardware minimum.
    const floor = await as(human, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', guarantees: ['no-runner-lands', 'independent-review', 'signed-authorship', 'human-gates-hardware'] });
    expect(floor.status).toBe(200);
    // A change admitting runner to refs.default_branch (or refs.other) is refused floor-violated.
    const { version, doc } = await current();
    const admitRunner = (refs: string[]) => ({ ...doc, refs: { ...doc.refs, default_branch: refs } });
    for (const refs of [['runner', 'trusted-runner', 'human'], ['trusted-runner', 'human', 'runner']] as const) {
      const refused = await as(human, '/v1/owner/ops/policy', { base_version: version, policy: admitRunner([...refs]) }, 'PUT');
      expect(refused.status).toBe(409);
      expect(refused.json.code).toBe('floor-violated');
      expect(refused.json.floor).toBe('fieldhouse');
      expect(refused.json.guarantee).toBe('no-runner-lands');
    }
    // A second floor with the name conflicts (the floors are judged on the policy alone, so
    // the fieldhouse four hold without any report — R-BTN-189).
    const again = await as(human, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', guarantees: ['human-gates'] });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('conflict');
    // Removal: an owner key is refused (remove_by: human), a human_only key accepted.
    const byOwner = await as(owner, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', remove: true, confirm: true });
    expect(byOwner.status).toBe(403);
    const byHuman = await as(human, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', remove: true, confirm: true });
    expect(byHuman.status).toBe(200);
    expect((await rows('SELECT count(*) AS n FROM policy_floors WHERE repository_id = ? AND name = ?', 'ops', 'fieldhouse'))[0].n).toBe(0);
  });

  it('a report that no longer matches raises baton.unprotected, releases the claim released:floor, and refuses claims floor-broken until a matching report', async () => {
    await protectedSigned();
    await as(human, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', guarantees: ['no-runner-lands', 'independent-review', 'signed-authorship', 'human-gates-hardware'] });
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
    // A matching report closes the condition at once, whatever the mismatch had read
    // (R-BTN-180: "closed by a matching report" — round 1, finding 1): the forge restored, the
    // reading is the original one again.
    await checkerBeat('ops', true, 'reading-1');
    expect((await rows(`SELECT count(*) AS n FROM policy_conditions WHERE repository_id = 'ops' AND type = 'baton.unprotected' AND closed_at IS NULL`))[0].n).toBe(0);
    await refreshOps();
    const again = await claimAsRunner();
    expect(again.json.ticket_id).toBe('ops:R3-9001');
    // A reading that CHANGES while matching raises the condition in its own right — the forge's
    // protection settings moved — and the next report repeating the new reading closes it.
    await checkerBeat('ops', true, 'reading-3');
    expect((await rows(`SELECT count(*) AS n FROM policy_conditions WHERE repository_id = 'ops' AND type = 'baton.unprotected' AND closed_at IS NULL`))[0].n).toBe(1);
    const refusedMoved = await claimAsRunner();
    expect(refusedMoved.json.rule_code).toBe('floor-broken');
    await checkerBeat('ops', true, 'reading-3');
    expect((await rows(`SELECT count(*) AS n FROM policy_conditions WHERE repository_id = 'ops' AND type = 'baton.unprotected' AND closed_at IS NULL`))[0].n).toBe(0);
    await refreshOps();
    expect((await claimAsRunner()).json.ticket_id).toBe('ops:R3-9001');
  });

  it('a report lapsed past 24 hours raises baton.unprotected and stops the repository until a fresh report', async () => {
    await protectedSigned();
    await as(human, '/v1/owner/ops/policy/floors', { name: 'fieldhouse', guarantees: ['no-runner-lands', 'independent-review', 'signed-authorship', 'human-gates-hardware'] });
    await checkerBeat('ops', true, 'reading-1');
    // R-BTN-189 (round 1, finding 7): a report lapsed past its 24 hours raises
    // `baton.unprotected` all the same as a failed one — the alarm's floor sweep opens it. (No
    // claim survives the jump: a lease is at most 24 hours, so the runner is reaped with its
    // own lease, not released by the floor.)
    await setClock(T0 + 25 * 3_600_000);
    await tick();
    expect((await rows(`SELECT count(*) AS n FROM policy_conditions WHERE repository_id = 'ops' AND type = 'baton.unprotected' AND closed_at IS NULL`))[0].n).toBe(1);
    // The floor stops the repository for a fresh runner (the old one reaped with its lease).
    await runnerBeatAs('runner-2', 'runner-secret-2');
    await refreshOps();
    const refused = await claimAs('runner-2', 'runner-secret-2');
    expect(refused.status).toBe(409);
    expect(refused.json.rule_code).toBe('floor-broken');
    // A fresh matching report, repeating its reading, closes it.
    await checkerBeatAs('checker-2', 'checker-secret-2', 'ops', true, 'reading-1');
    expect((await rows(`SELECT count(*) AS n FROM policy_conditions WHERE repository_id = 'ops' AND type = 'baton.unprotected' AND closed_at IS NULL`))[0].n).toBe(0);
    await refreshOps();
    expect((await claimAs('runner-2', 'runner-secret-2')).json.ticket_id).toBe('ops:R3-9001');
  });

  it('returns the same unsigned policy to authorized readers', async () => {
    await protectedSigned();
    expect((await keyCall(admin, '/v1/admin/settings', { check_app_id: '12345' }, 'PUT')).status).toBe(200);
    const path = '/v1/repositories/ops/policy';
    const read = await as(owner, path);
    expect(read.status).toBe(200);
    expect(await as(runnerKey, path)).toEqual(read);
    expect(Object.keys(read.json).sort()).toEqual([
      'at', 'check_app_id', 'floors', 'guarantees', 'hash', 'policy', 'repository', 'valid_until', 'version',
    ]);
    expect(read.json.check_app_id).toBe('12345');
    // Published CLI 0.1.3/0.1.4 call this unconditionally after printing the JSON.
    expect(new Date(read.json.valid_until).toISOString()).toBe(new Date(T0).toISOString());
    expect(read.json.valid_until).toBe(read.json.at);
  });

  it('ignores a legacy runner policy pin without gating claims or opening a condition', async () => {
    await protectedSigned();
    await rows('UPDATE runner_grants SET trust_level = ?, trust_domain = ? WHERE credential_id = ? AND repository_id = ?', 'trusted', 'runner-host', runnerKey.fingerprint, 'ops');
    const beat = await runnerBeat('runner-secret', { policy_pins: [{ repository: 'ops', hash: 'e'.repeat(64) }] });
    expect(beat.status).toBe(200);
    expect(beat.json).not.toHaveProperty('policies');
    expect(await rows(`SELECT * FROM policy_conditions WHERE type = 'baton.policy-unpinned'`)).toEqual([]);
    await refreshOps();
    const claim = await claimAsRunner();
    expect(claim.status).toBe(200);
    expect(claim.json.ticket_id).toBe('ops:R3-9001');
  });
});

/** The runner claims whatever ops offers. */
async function claimAsRunner() {
  return claimAs('runner', 'runner-secret');
}

/** A runner session claims whatever ops offers. */
async function claimAs(session: string, secret: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(runnerKey, ORIGIN + '/v1/runner/claim', {
    created, method: 'POST', headers: { 'X-Runner-Secret': secret }, body: JSON.stringify({ request_id: `req-${session}-${Math.random().toString(16).slice(2)}`, ...(session === 'runner' ? {} : {}) }),
  }));
  void session;
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}
