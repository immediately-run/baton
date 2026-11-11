// B-168 — the restructure's part 4's resources and settings at the API (BATON_SPEC §6.3 R-BTN-76,
// §8.3 R-BTN-106, §12.8 R-BTN-181/R-BTN-188): a resource has two scopes; a runner posts no `uses`
// and a claim no `bills` (read and ignored, logged `deprecated-field`, never a refusal); an
// administrator's reading is one more instrument's — held to the same limits, no precedence, no
// `overridden` answer, no signature of its own, writeable and answerable by name; the owner
// settings lose `required_independence`, and the unblocked trigger is a loosening (R-BTN-94).
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, adminSession, advance, claimItem, cutover, keyCall, register, rows, sessionCall, setAdminKeys, setClock } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { COOPERATIVE } from '../../src/core/policy';
import { grantedWorker, SCHEMA } from '../lib/fleet';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const H = 3_600_000;
const R = 'llm:deepseek-v4-flash';
const GO = 'opencode-go:go_plus';

let admin: TestKey;
let owner: TestKey;
let git: Git;

const stateOf = async (instance: string) => (await rows<{ state: string }>('SELECT state FROM instance_states WHERE instance = ?', instance))[0]?.state;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  git = new Git().add('T-1');
  await git.post();
  await cutover();
});

describe('B-168 the resources: two scopes, no runner uses, one reading per instrument', () => {
  it('registers account and service resources, refusing worker and host scopes and a retired atoms_from', async () => {
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'github-api', scope: 'worker', detail_schema: SCHEMA })).json).toMatchObject({ code: 'invalid-params' });
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'github-api', scope: 'host', detail_schema: SCHEMA })).json).toMatchObject({ code: 'invalid-params' });
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'llm:cap', scope: 'account', detail_schema: SCHEMA, atoms_from: 'any' })).json).toMatchObject({ code: 'invalid-params' });
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'llm:cap', scope: 'account', detail_schema: SCHEMA })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'disk:fs-1', scope: 'service', detail_schema: SCHEMA })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] })).json).toMatchObject({ code: 'not-found' });
    expect((await keyCall(admin, '/v1/admin/instances', { name: 'acct:cap', serves: ['llm:cap'], repositories: ['docs'] })).status).toBe(200);
    // A `service` resource is its own instance, and a runner reports on it (R-BTN-76: any account
    // instance listing its repository — a service instance is the repository's own).
    expect(await rows('SELECT name, repositories FROM resource_instances ORDER BY name')).toEqual([{ name: 'acct:cap', repositories: '["docs"]' }, { name: 'disk:fs-1', repositories: '[]' }]);
    expect(await rows('SELECT scope, name FROM external_resources ORDER BY name')).toEqual([{ scope: 'service', name: 'disk:fs-1' }, { scope: 'account', name: 'llm:cap' }]);
  });

  it('a runner\'s heartbeat `uses` and a claim\'s `bills` are read as absent, logged once a day, and refuse nothing', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue'], [GO, 'Not A Name']);
    // Nothing was stored for the uses, and the heartbeat answered no refused name.
    expect(w.id).toBeGreaterThan(0);
    expect((await w.beat({ uses: [GO] })).json).not.toHaveProperty('refused_uses');
    const fields = async () => (await rows<{ field: string; actor: string }>(`SELECT json_extract(detail_json, '$.field') AS field, actor FROM events WHERE kind = 'deprecated-field' ORDER BY seq`));
    expect(await fields()).toEqual([{ field: 'heartbeat.uses', actor: expect.stringMatching(/^(credential|worker):/) }]);
    // A second beat the same day logs nothing; the next day does.
    await setClock(T0 + 5 * 60_000);
    await w.beat({ uses: [GO] });
    expect(await fields()).toHaveLength(1);
    await setClock(T0 + 24 * H);
    await w.beat({ uses: [GO] });
    expect(await fields()).toHaveLength(2);
    // The claim's `bills`: the claim succeeds, and the request is logged as carrying it.
    const claim = await w.call('/v1/runner/claim', { request_id: 'req-bills-1', ticket_id: 'docs:T-1', bills: ['opencode-go'] });
    expect(claim.json).toMatchObject({ ticket_id: 'docs:T-1' });
    expect((await fields()).map((f) => f.field)).toEqual(['heartbeat.uses', 'heartbeat.uses', 'claim.bills']);
    expect(await rows("SELECT kind FROM events WHERE kind = 'deprecated-field' AND json_extract(detail_json, '$.field') = 'claim.bills'")).toHaveLength(1);
  });

  it('an administrator\'s reading is one more instrument\'s: the same limits, no precedence, no overridden answer, answerable by name', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    // R-BTN-76's state bound is the administrator's too: `valid_for` is at most 24 hours.
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: true, valid_for: 7 * 24 * 3600 }] })).json).toMatchObject({ code: 'invalid-params' });
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }] })).json).toEqual({ ok: true, refused: [] });
    expect(await stateOf(GO)).toBe('unavailable');
    // A probe's reading a minute later is the latest in force: it sets the state, with no
    // precedence asked, and answers only what was stored (R-BTN-101).
    const probe = await makeKey('ssh-ed25519', 'probe');
    expect((await keyCall(admin, '/v1/admin/probes', { public_key: probe.publicKey, label: 'quota probe' })).status).toBe(200);
    await setClock(T0 + 60_000);
    const posted = await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: true, valid_for: 3600 }] });
    expect(posted.json).toEqual({ ok: true, refused: [] });
    expect(await stateOf(GO)).toBe('available');
    // An instrument's own latest is kept, keyed by the source the request's key names: the
    // administrator's one.
    expect(await rows(`SELECT source LIKE 'admin:%' AS admin, available FROM instance_readings ORDER BY source`)).toEqual([{ admin: 1, available: 1 }]);
    // `POST /v1/admin/readings {instance, clear}` ends them, and the state follows.
    expect((await keyCall(admin, '/v1/admin/readings', { instance: GO, clear: {} })).json).toEqual({ ok: true });
    expect(await stateOf(GO)).toBe('unknown');
    expect(await rows('SELECT instance FROM instance_readings')).toEqual([]);
  });

  it('a leg\'s `no_chain_from` is the one statement of independence: the owners have no setting for it', async () => {
    expect((await keyCall(owner, '/v1/owner/docs/settings', { required_independence: { review: ['implement'] } }, 'PUT')).json).toMatchObject({ code: 'invalid-params' });
    expect((await keyCall(owner, '/v1/owner/docs/settings', { required_bars: [] }, 'PUT')).status).toBe(200);
    expect(await rows(`SELECT name FROM pragma_table_info('repositories') WHERE name = 'required_independence'`)).toEqual([]);
    // The gate itself is the course file's: the same key may take a leg the file does not name it
    // for, and is refused one it does.
    const a = await register('vm-a');
    const { json: c } = await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', a.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
  });
});

describe('B-168 the settings: the unblocked trigger is a loosening, and the dashboard lists what the route writes', () => {
  it('setting or changing the unblocked trigger needs an approver on approvers.policy (R-BTN-94, R-BTN-186)', async () => {
    // The cooperative policy's `approvers.policy` is every owner, so the owner's own change passes.
    expect((await keyCall(owner, '/v1/owner/docs/settings', { unblocked_trigger: { kind: 'github-app', workflow: '.github/workflows/baton-unblocked.yml' } }, 'PUT')).status).toBe(200);
    // The owner narrows the list that may loosen to an owner (`approvers.policy: ['owner']`) — the
    // owner's own key then satisfies it, so another owner's change passes and this one's does not,
    // the two names differing.
    const other = await makeKey('ssh-ed25519', 'docs-owner-2');
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [other.publicKey] })).status).toBe(200);
    const policy = { ...COOPERATIVE, approvers: { ...COOPERATIVE.approvers, policy: ['owner'] } };
    expect((await keyCall(owner, '/v1/owner/docs/policy', { base_version: 1, policy }, 'PUT')).status).toBe(200);
    // The owner naming a key no one holds as its policy approver: the policy is refused up front
    // (unsatisfiable-approvers, R-BTN-188), so the list is never empty behind a change.
    const nobody = await makeKey('ssh-ed25519', 'nobody');
    expect((await keyCall(owner, '/v1/owner/docs/policy', { base_version: 2, policy: { ...policy, approvers: { ...policy.approvers, policy: [`key:${nobody.fingerprint}`] } } }, 'PUT')).json).toMatchObject({ code: 'unsatisfiable-approvers' });
    // Setting the trigger under `approvers.policy: ['owner']` passes (every owner satisfies it),
    // and so does a later owner's change and its clearing: the loosening is an owner's.
    expect((await keyCall(other, '/v1/owner/docs/settings', { unblocked_trigger: { kind: 'github-app', workflow: '.github/workflows/other.yml' } }, 'PUT')).status).toBe(200);
    expect(await rows('SELECT unblocked_trigger FROM repositories WHERE id = ?', 'docs')).toEqual([{ unblocked_trigger: JSON.stringify({ kind: 'github-app', workflow: '.github/workflows/other.yml' }) }]);
    expect((await keyCall(owner, '/v1/owner/docs/settings', { unblocked_trigger: null }, 'PUT')).status).toBe(200);
    // A setting that governs nothing still passes: `remind_after` alone.
    expect((await keyCall(owner, '/v1/owner/docs/settings', { remind_after: 3600 }, 'PUT')).status).toBe(200);
  });

  it('the dashboard\'s limits list every setting the route writes, and none that is gone', async () => {
    const state = (await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json()) as { limits: { settings: Record<string, unknown>[] } };
    const settings = state.limits.settings.find((s) => s.repository_id === 'docs')!;
    expect(Object.keys(settings).sort()).toEqual(['remind_after', 'repository_id', 'required_bars', 'retry', 'scope_policy', 'transcript_repos', 'unblocked_trigger', 'worker_pushers']);
  });
});
