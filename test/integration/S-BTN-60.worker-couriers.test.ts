// S-BTN-60 worker couriers (BATON_SPEC §15; R3-1256), on both hosts. The scenario is retired —
// the history's "Retired scenarios and gates" table: a courier is a runner with a capability now,
// and B-67 deletes this file; check-spec's RETIRED_TESTS_ALLOWED list holds it until then. W1 and W2
// heartbeat `couriers: [{repository: docs, asks: [owner]}]`; the owner's CLI key is a personal
// courier; a decision opens; later, `ops` has an `owner` decision and no courier of either kind.
// Must hold: the decision queued twice — once to the pool and once to the CLI; W1 claims the pool
// copy and fails it, W2 then claims and sends it; the CLI's copy unaffected; with both workers gone
// for a day a new decision gets no pool copy; `ops` under Needs you for having no personal `owner`
// channel, and a pool copy unclaimed for an hour there too.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, adminSession, keyCall, placed, rows, sessionCall, setAdminKeys, setClock, syncToken, tick } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { grantedWorker, signed, type FleetWorker } from '../lib/fleet';
import { POOL } from '../../src/core/notices';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const COURIERS = [{ repository: 'docs', asks: ['owner'] }];

let admin: TestKey;
let owner: TestKey;
let opsOwner: TestKey;
let cli: TestKey;
let git: Git;
let w1: FleetWorker;
let w2: FleetWorker;

const decision = (id: string) => placed('filed', [], [['implement', 'ready']], { decisions: [{ id, asks: 'owner' }] });
const copies = (ref: string) => rows<{ credential_id: string; state: string; claimed_by: string | null }>(
  'SELECT credential_id, state, claimed_by FROM notices WHERE ref = ? ORDER BY credential_id', ref);
const poolClaim = (w: FleetWorker) => signed(w.key, '/v1/courier/notices/claim?repository=docs', { body: {} });
const needsYou = async () => {
  const res = await sessionCall(await adminSession(admin), '/v1/ui/state');
  return ((await res.json()) as { needs_you: { pool_unclaimed: unknown[]; no_owner_channel: unknown[] } }).needs_you;
};

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  cli = await makeKey('ssh-ed25519', 'owner-cli');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [opsOwner.publicKey] })).status).toBe(200);
  expect((await keyCall(owner, '/v1/owner/docs/couriers', { public_key: cli.publicKey, asks: ['owner'] })).status).toBe(200);
  w1 = await grantedWorker(owner, 'docs', 'w1', ['agent-venue']);
  w2 = await grantedWorker(owner, 'docs', 'w2', ['agent-venue']);
  for (const w of [w1, w2]) expect((await w.beat({ couriers: COURIERS })).status).toBe(200);
  git = new Git().add('D', {}, decision('D-1'));
  expect((await git.post()).status).toBe(200);
});

describe('S-BTN-60 worker couriers', () => {
  it('one pool copy beside the personal one; a failed claim returns it to the pool for the next worker', async () => {
    expect(await copies('D-1')).toEqual([cli.fingerprint, POOL].sort().map((c) => ({ credential_id: c, state: 'queued', claimed_by: null })));

    // W1 claims the pool copy, and W2 is offered nothing while W1 holds it.
    const c1 = await poolClaim(w1);
    expect(c1.json.notices.map((n: { decision: { id: string } }) => n.decision.id)).toEqual(['D-1']);
    expect((await poolClaim(w2)).json.notices).toEqual([]);
    const id = c1.json.notices[0].notice_id as string;
    // W1 fails it: back to the pool after the backoff, and W2 claims and sends it.
    expect((await signed(w1.key, `/v1/courier/notices/${id}?repository=docs`, { body: { state: 'failed' } })).status).toBe(200);
    await setClock(T0 + MIN);
    const c2 = await poolClaim(w2);
    expect(c2.json.notices.map((n: { notice_id: string }) => n.notice_id)).toEqual([id]);
    expect((await signed(w2.key, `/v1/courier/notices/${id}?repository=docs`, { body: { state: 'sent', channel: 'chat' } })).status).toBe(200);
    // W1, no longer its claimer, may not mark it.
    expect((await signed(w1.key, `/v1/courier/notices/${id}?repository=docs`, { body: { state: 'sent' } })).json.code).toBe('forbidden');
    const pool = (await copies('D-1')).find((n) => n.credential_id === POOL);
    expect(pool).toEqual({ credential_id: POOL, state: 'sent', claimed_by: w2.key.fingerprint });
    // The CLI's own copy is unaffected.
    expect((await copies('D-1')).find((n) => n.credential_id === cli.fingerprint)).toEqual({ credential_id: cli.fingerprint, state: 'queued', claimed_by: null });
  });

  it('with both workers gone for a day a new decision gets no pool copy; Needs you names the gaps', async () => {
    // A pool copy unclaimed for an hour is listed.
    await setClock(T0 + H);
    await tick();
    expect((await needsYou()).pool_unclaimed).toEqual([{ repository_id: 'docs', ticket_id: 'docs:D', decision: 'D-1', since: T0 }]);

    // `ops` posts an owner decision, with no courier of either kind.
    const ops = new Git(await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' }));
    ops.add('O', {}, decision('O-1'));
    expect((await ops.post()).status).toBe(200);
    expect(await copies('O-1')).toEqual([]);
    expect((await needsYou()).no_owner_channel).toEqual([{ repository_id: 'ops', decisions: 1 }]);

    // Both workers go silent; a day after their last heartbeat, a new decision gets no pool copy.
    await setClock(T0 + 24 * H + MIN);
    git.add('N', {}, decision('N-1'));
    expect((await git.post()).status).toBe(200);
    expect((await copies('N-1')).map((n) => n.credential_id)).toEqual([cli.fingerprint]);
  });
});
