// S-BTN-198 retirement (BATON_SPEC §15 S-BTN-198, §3.1 R-BTN-47's *Retirement*; B-173): retiring
// a repository ends everything scoped to it, in one transaction, over the stores that exist —
// sync and mirror keys and runner grants revoked, each active claim reaped as an administrator's
// force-reap (fence-pending where its runner is alive, so the old holder can still heartbeat and
// report the fence, R-BTN-19), its sync wants, `webhook_syncs` stamps and unblocked trigger
// deleted, its id out of every account instance's `repositories` list, the row tombstoned
// (`~retired/<id>`, its path to `former_paths`) so the path is free and the id is never
// registered again. From then on every route naming it answers `not-found` — one check, not each
// query's filter — its CI identity and forge notifications are refused, and no want or dispatch
// is recorded for it. The fence is the one thing still live: the holder queries answer for its
// former path while a fence is pending, and the fence clears on the holder's report or at the
// alarm. The stores later tickets build (owner sessions, MCP keys, OAuth, registration tokens,
// check-runners, consents, ticket timers, the outbox) extend this file with their own cases.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, captureDispatches, claimItem, claimRow, course, ORIGIN, placed, register, rows, sessionCall, setAdminKeys, setClock, setHumanKeys, setPolicySigningKey, sha256, syncCall, tick, ticket, withCore, webhookCall, workerCall } from '../helpers';
import { makeKey, signedRequest, sshsig, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-13T12:00:00Z');
let admin: TestKey;
let owner: TestKey;
let opsOwner: TestKey;
let opsSync: TestKey;
let runner: TestKey;

/** The repository this scenario retires: a sync key for its board, an owner key of its own. */
const OPS = { id: 'ops', github: 'immediately-run/ops', default_branch: 'main', ci_identity: null };
const code = async (res: Response) => (res.status === 200 ? 200 : ((await res.clone().json()) as { code: string }).code);

/** The core's clock in seconds, read in its own turn (as `keyCall` reads it). */
const nowS = async () => Math.floor((await withCore((c) => c.now())) / 1000);

/** A request signed by `key` at the core's clock — a sync key's, a runner key's, an owner's. */
const signed = async (key: TestKey, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  hostCall(await signedRequest(key, ORIGIN + path, { created: await nowS(), body: body === undefined ? undefined : JSON.stringify(body), headers }));

/** An administrator's or owner's call: signed, with the JSON body a route takes. */
const keyCall = async (key: TestKey, path: string, body?: unknown, method?: string) =>
  hostCall(await signedRequest(key, ORIGIN + path, { created: await nowS(), method, body: body === undefined ? undefined : JSON.stringify(body) }));

let secret: string;
let claimId: number;

/** The granted runner's heartbeat body: a checkout of ops' course. */
const beatBody = (over: Record<string, unknown> = {}) => ({
  hostname: 'ops-vm', session_name: 's-ops', harness: 'opencode', kind: 'vm', capabilities: ['agent-venue'],
  tier_ceiling: 'critical', lease_timeout_s: 900, courses: [{ repository: 'ops', course: 'roadmap-pr', version: 3 }], ...over,
});
const beat = (over: Record<string, unknown> = {}) => signed(runner, '/v1/runner/heartbeat', beatBody(over), { 'X-Worker-Secret': secret });

/** Register ops, post its board as its sync key, and let a granted runner hold its one ticket. */
async function aLiveRepository(): Promise<void> {
  expect((await keyCall(admin, '/v1/admin/repositories', { ...OPS, sync_keys: [{ public_key: opsSync.publicKey, role: 'sync' }], owner_keys: [opsOwner.publicKey, owner.publicKey] })).status).toBe(200);
  await rows('UPDATE repositories SET cutover_at = 1 WHERE id = ?', 'ops');
  // The board as its sync key posts it (R-BTN-93): one ticket, queued for its first leg.
  const obs = await signed(opsSync, '/v1/sync/observation', {});
  expect(obs.status, JSON.stringify(await obs.clone().json())).toBe(200);
  const observation = ((await obs.json()) as { observation: number }).observation;
  const post = await signed(opsSync, '/v1/sync/board', {
    registry: [course()], sha: 'a'.repeat(40), parent_sha: null, closed: [], observation,
    tickets: [ticket('T-1', { repos: ['immediately-run/ops'] })],
    stations: { 'T-1': placed('filed', [], [['implement', 'ready']]) },
  });
  expect(post.status, JSON.stringify(await post.clone().json())).toBe(200);
  // An unblocked trigger, so retirement deletes one that exists (R-BTN-77).
  expect((await keyCall(opsOwner, '/v1/owner/ops/settings', { unblocked_trigger: { kind: 'github-app', workflow: '.github/workflows/unblock.yml' } }, 'PUT')).status).toBe(200);
  // A granted runner holding ops:T-1 (R-BTN-58).
  expect((await keyCall(admin, '/v1/admin/grants', { repository: 'ops', public_key: runner.publicKey, hostname: 'ops-vm', capabilities: ['agent-venue'] })).status).toBe(200);
  secret = `secret-${Math.random().toString(16).slice(2)}`;
  const first = await beat({ secret_hash: await sha256(secret) });
  expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
  const claim = await signed(runner, '/v1/runner/claim', { request_id: 'retire-1', ticket_id: 'ops:T-1' }, { 'X-Worker-Secret': secret });
  expect(claim.status, JSON.stringify(await claim.clone().json())).toBe(200);
  claimId = ((await claim.json()) as { claim_id: number }).claim_id;
  // The rows retirement deletes: a stale webhook stamp, a pending trailing dispatch, a pending
  // unblocked dispatch, and an account instance listing the repository (R-BTN-73, R-BTN-77, R-BTN-76).
  await rows(`INSERT INTO webhook_syncs (repository_id, last_dispatch_at) VALUES ('ops', ?)`, T0 - 11 * 60_000);
  await rows(`INSERT INTO webhook_dispatch (repository_id, last_dispatch_at, trailing_at) VALUES ('ops', ?, ?)`, T0 - 60_000, T0 + 30_000);
  await rows(`INSERT INTO unblocked_dispatch (repository_id, pending_json, due_at) VALUES ('ops', ?, ?)`, JSON.stringify([{ ticket: 'ops:T-1', cleared: [] }]), T0 + 30_000);
  await rows(`INSERT INTO external_resources (name, scope, detail_schema) VALUES ('acme', 'account', '{}')`);
  await rows(`INSERT INTO resource_instances (name, repositories) VALUES ('acme', ?)`, JSON.stringify(['ops', 'docs']));
  await rows(`INSERT INTO instance_serves (instance, resource) VALUES ('acme', 'acme')`);
  await rows(`INSERT INTO instance_states (instance, state, changed_at) VALUES ('acme', 'unknown', ?)`, T0);
}

/** Retire ops, confirmed (§12.2), at the clock's now. */
const retire = () => keyCall(admin, '/v1/admin/repositories', { id: 'ops', retire: true, confirm: true });

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'retire-admin');
  owner = await makeKey('ssh-ed25519', 'retire-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  opsSync = await makeKey('ssh-ed25519', 'ops-sync');
  runner = await makeKey('ssh-ed25519', 'ops-runner');
  await setAdminKeys(admin);
  // `owner` owns docs, so a key reaching two repositories keeps the other when ops retires.
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
});

describe('S-BTN-198 retirement', () => {
  it('ends everything scoped to the repository in one transaction, and no want or dispatch follows', async () => {
    await aLiveRepository();
    // §12.2: retiring is destructive, so it takes confirm: true.
    expect(await code(await keyCall(admin, '/v1/admin/repositories', { id: 'ops', retire: true }))).toBe('confirm-required');
    const sent = await captureDispatches();
    expect((await retire()).status).toBe(200);
    expect(sent).toEqual([]); // R-BTN-94: no want and no dispatch — not for the reaps' ends either
    // The tombstone (R-BTN-138): the path moves to former_paths, the dead columns go.
    expect(await rows(`SELECT retired_at, github, former_paths, web_base, dispatch, unblocked_trigger FROM repositories WHERE id = 'ops'`))
      .toEqual([{ retired_at: T0, github: '~retired/ops', former_paths: '["immediately-run/ops"]', web_base: null, dispatch: null, unblocked_trigger: null }]);
    // R-BTN-93, R-BTN-58: the sync key and the runner grant are revoked.
    expect(await rows(`SELECT revoked_at FROM sync_keys WHERE repository_id = 'ops'`)).toEqual([{ revoked_at: T0 }]);
    expect(await rows(`SELECT revoked_at FROM worker_grants WHERE repository_id = 'ops'`)).toEqual([{ revoked_at: T0 }]);
    // R-BTN-19: the claim is reaped as an administrator's force-reap — the runner is alive, so
    // the claim is fence-pending and the worker is not reaped.
    expect(await claimRow(claimId)).toMatchObject({ status: 'reaped', end_reason: 'reaped:owner', fence_pending: 1 });
    expect(await rows(`SELECT reaped_at FROM workers WHERE hostname = 'ops-vm'`)).toEqual([{ reaped_at: null }]);
    expect(await rows(`SELECT actor FROM events WHERE kind = 'reaped' AND ticket_id = 'ops:T-1'`)).toEqual([{ actor: `admin:${admin.fingerprint}` }]);
    expect(await rows(`SELECT detail_json FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'repository-retired'`))
      .toEqual([{ detail_json: JSON.stringify({ act: 'repository-retired', repository: 'ops', github: 'immediately-run/ops' }) }]);
    // The wants, stamps, windows and the trigger's rows are gone; the instance lists it no more.
    for (const table of ['webhook_dispatch', 'webhook_syncs', 'unblocked_dispatch']) {
      expect(await rows(`SELECT 1 FROM ${table} WHERE repository_id = 'ops'`)).toEqual([]);
    }
    expect(await rows(`SELECT repositories FROM resource_instances WHERE name = 'acme'`)).toEqual([{ repositories: '["docs"]' }]);
    // The alarm's backstop sends it nothing.
    await tick();
    expect(sent.filter((s) => s.startsWith('ops:'))).toEqual([]);
    // R-BTN-47: an administrator's dashboard session still shows its fence-pending claims, so
    // the fence clear can be reached.
    const state = (await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json()) as { needs_you: { fence_pending: { id: number; ticket_id: string }[] } };
    expect(state.needs_you.fence_pending).toEqual([expect.objectContaining({ id: claimId, ticket_id: 'ops:T-1' })]);
    // Every route naming it answers not-found (R-BTN-47), whoever asks — an authenticated
    // principal gets not-found; a key whose only repository it was is no principal at all
    // (R-BTN-155), as a key that owns nothing has always been.
    expect(await code(await keyCall(owner, '/v1/owner/ops/settings', {}, 'PUT'))).toBe('not-found');
    expect(await code(await keyCall(admin, '/v1/owner/ops/grants'))).toBe('not-found');
    expect(await code(await keyCall(admin, '/v1/repositories/ops/board'))).toBe('not-found');
    expect(await code(await keyCall(opsOwner, '/v1/repositories/ops/attestations', {}))).toBe('not-found');
    expect((await workerCall('/v1/repositories/ops/stats')).status).toBe(404);
    const w = await register('vm-a');
    const claimed = await claimItem('vm-a', w.secret, { ticket_id: 'ops:T-1' });
    expect(claimed.status === 200 ? 200 : claimed.json.code).toBe('not-found');
  });

  it('a heartbeat declaring its course drops it; the holder queries answer for its former path', async () => {
    await aLiveRepository();
    await retire();
    // R-BTN-3: the old holder's heartbeat is answered, the retired repository's course dropped —
    // never a refusal — so it can still report the fence.
    const hb = await beat();
    expect(hb.status, JSON.stringify(await hb.clone().json())).toBe(200);
    const json = (await hb.json()) as { courses_retired?: string[]; mode: Record<string, unknown> };
    expect(json.courses_retired).toEqual(['ops']);
    expect(json.mode).not.toHaveProperty('ops');
    expect(await rows(`SELECT 1 FROM worker_courses c JOIN workers w ON w.id = c.worker_id WHERE w.hostname = 'ops-vm' AND c.repository_id = 'ops'`)).toEqual([]);
    // The sync key's next post is refused (R-BTN-93: a revoked key is unauthenticated, as
    // S-BTN-55 finds).
    expect(await code(await signed(opsSync, '/v1/sync/head'))).toBe('unauthenticated');
    // R-BTN-7: the holder queries keep answering — by ticket id, and for the former path
    // (R-BTN-138) while the fence is pending and no live repository holds the path.
    expect(await (await workerCall('/v1/runner/tickets/ops:T-1/holder')).json()).toEqual({ held_by_other: false, fence_pending: true });
    expect(await (await workerCall('/v1/runner/branch-holder?repo=immediately-run/ops.git&branch=claude/T-1-implement')).json())
      .toEqual({ tickets: ['ops:T-1'], held_by_other: false, fence_pending: true });
    // A key whose only repositories are retired owns none (R-BTN-155): opsOwner authenticates
    // no more, while the key that reached two repositories keeps the other.
    expect(await code(await keyCall(opsOwner, '/v1/admin/probes', {}))).toBe('unauthenticated');
    expect((await keyCall(owner, '/v1/owner/docs/grants')).status).toBe(200);
    // The id is never registered again (conflict); a change naming it neither; a second retire
    // names what is no longer there.
    expect(await code(await keyCall(admin, '/v1/admin/repositories', { ...OPS, owner_keys: [opsOwner.publicKey] }))).toBe('conflict');
    expect(await code(await keyCall(admin, '/v1/admin/repositories', { id: 'ops', weight: 5 }))).toBe('conflict');
    expect(await code(await retire())).toBe('not-found');
    // The path is free among live rows: another repository takes it, and the former path stops
    // reaching the fence the moment a live repository holds it.
    const ops2Sync = await makeKey('ssh-ed25519', 'ops2-sync');
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops2', github: 'immediately-run/ops', default_branch: 'main', ci_identity: null, sync_keys: [{ public_key: ops2Sync.publicKey, role: 'sync' }], owner_keys: [opsOwner.publicKey] })).status).toBe(200);
    expect(await (await workerCall('/v1/runner/branch-holder?repo=immediately-run/ops.git&branch=claude/T-1-implement')).json())
      .toEqual({ tickets: [], held_by_other: false, fence_pending: false });
  });

  it('the fence clears on the holder\'s report, and the former path stops reaching', async () => {
    await aLiveRepository();
    await retire();
    expect(await claimRow(claimId)).toMatchObject({ fence_pending: 1 });
    const hb = await beat({ fenced: { claim_id: claimId, terminated: true } });
    expect(hb.status, JSON.stringify(await hb.clone().json())).toBe(200);
    expect(await claimRow(claimId)).toMatchObject({ status: 'reaped', fence_pending: 0 });
    expect(await rows(`SELECT kind FROM events WHERE kind = 'fence-cleared' AND ticket_id = 'ops:T-1'`)).toEqual([{ kind: 'fence-cleared' }]);
    // Nothing reaches the retired repository's former path once no fence is pending.
    expect(await (await workerCall('/v1/runner/branch-holder?repo=immediately-run/ops.git&branch=claude/T-1-implement')).json())
      .toEqual({ tickets: [], held_by_other: false, fence_pending: false });
    expect(await (await workerCall('/v1/runner/tickets/ops:T-1/holder')).json()).toEqual({ held_by_other: false, fence_pending: false });
  });

  it('the alarm clears a retired repository\'s fence when its runner goes silent (R-BTN-19)', async () => {
    await aLiveRepository();
    await retire();
    await setClock(T0 + 20 * 60_000); // past the runner's 15-minute lease
    await tick();
    expect(await claimRow(claimId)).toMatchObject({ fence_pending: 0 });
    expect(await rows(`SELECT kind FROM events WHERE kind = 'fence-cleared' AND ticket_id = 'ops:T-1'`)).toEqual([{ kind: 'fence-cleared' }]);
    expect((await rows<{ reaped_at: number | null }>(`SELECT reaped_at FROM workers WHERE hostname = 'ops-vm'`))[0].reaped_at).not.toBeNull();
  });

  it('a retired repository\'s CI identity and forge notifications are refused', async () => {
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', retire: true, confirm: true })).status).toBe(200);
    // R-BTN-15: docs' CI identity no longer serves a repository — the tombstone freed the path.
    expect(await code(await syncCall('/v1/sync/head'))).toBe('forbidden');
    // R-BTN-73: a delivery naming its path dispatches nothing and stamps no row.
    const sent = await captureDispatches();
    expect((await webhookCall('pull_request', { repository: { full_name: 'immediately-run/docs' }, pull_request: { merged: true } })).status).toBe(204);
    expect(sent).toEqual([]);
    expect(await rows(`SELECT 1 FROM webhook_syncs WHERE repository_id = 'docs'`)).toEqual([]);
  });

  it('the seed skips and logs an entry naming a retired id, never a stop (B-91, R-BTN-47)', async () => {
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'baton', retire: true, confirm: true })).status).toBe(200);
    await withCore((c) => c.start());
    expect(await rows(`SELECT detail_json FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'seed-skipped-retired'`))
      .toEqual([{ detail_json: JSON.stringify({ act: 'seed-skipped-retired', repository: 'baton' }) }]);
    // Its sync keys are skipped with it: an entry naming the retired id with one never throws.
    const key = await makeKey('ssh-ed25519', 'retired-seed-sync');
    const seeded = await withCore((c) => (c as unknown as { ports: { config: { BATON_REPOSITORIES?: string } } }).ports.config.BATON_REPOSITORIES!);
    await withCore((c) => {
      (c as unknown as { ports: { config: Record<string, string | undefined> } }).ports.config.BATON_REPOSITORIES = JSON.stringify([
        ...(JSON.parse(seeded) as Record<string, unknown>[]).filter((e) => e.id !== 'baton'),
        { id: 'baton', github: 'immediately-run/baton', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', cut_over: true,
          sync_keys: [{ public_key: key.publicKey, role: 'sync' }] },
      ]);
    });
    await withCore((c) => c.start());
    expect(await rows(`SELECT 1 FROM sync_keys WHERE repository_id = 'baton'`)).toEqual([]);
    expect(await rows(`SELECT count(*) AS n FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'seed-skipped-retired'`)).toEqual([{ n: 2 }]);
  });

  it('the seed skips a retired entry whole: its owner keys never stop the start (B-91, R-BTN-47)', async () => {
    await aLiveRepository();
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'baton', retire: true, confirm: true })).status).toBe(200);
    // The retired entry's owner_keys name a key that holds another role — ops' sync key. The
    // entry is skipped before `mayOwn` could refuse it, as the sync-key case above skips its keys.
    const seeded = await withCore((c) => (c as unknown as { ports: { config: { BATON_REPOSITORIES?: string } } }).ports.config.BATON_REPOSITORIES!);
    await withCore((c) => {
      (c as unknown as { ports: { config: Record<string, string | undefined> } }).ports.config.BATON_REPOSITORIES = JSON.stringify([
        ...(JSON.parse(seeded) as Record<string, unknown>[]).filter((e) => e.id !== 'baton'),
        { id: 'baton', github: 'immediately-run/baton', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', cut_over: true,
          owner_keys: [opsSync.publicKey] },
      ]);
    });
    await withCore((c) => c.start());
    expect(await rows(`SELECT 1 FROM repository_owners WHERE repository_id = 'baton'`)).toEqual([]);
    expect(await rows(`SELECT count(*) AS n FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'seed-skipped-retired'`)).toEqual([{ n: 1 }]);
  });

  it('a retired repository\'s bars reach no one, and its id names no mode (R-BTN-67, R-BTN-47)', async () => {
    await aLiveRepository();
    expect((await keyCall(opsOwner, '/v1/owner/ops/bars', { course: 'roadmap-pr', tag: 'block:ops-retire', applies: 'claim', reason: 'ops-retire-pin' })).status).toBe(200);
    // Before: the granted runner's heartbeat carries the bar in force on its repository.
    const before = (await (await beat()).json()) as { bars: { tag: string }[] };
    expect(before.bars.map((b) => b.tag)).toEqual(['block:ops-retire']);
    await retire();
    // The bar stays on the row, unlifted — and reaches no one (R-BTN-47: outside every rule).
    expect(await rows(`SELECT count(*) AS n FROM owner_bars WHERE repository_id = 'ops' AND lifted_at IS NULL`)).toEqual([{ n: 1 }]);
    const after = (await (await beat()).json()) as { bars: unknown[]; courses_retired: string[] };
    expect(after.bars).toEqual([]);
    expect(after.courses_retired).toEqual(['ops']);
    // `?repository=` of /v1/runner/mode reads the live predicate: a retired id is as one never
    // registered.
    expect(await code(await signed(runner, '/v1/runner/mode?repository=ops', undefined, { 'X-Worker-Secret': secret }))).toBe('invalid-params');
  });

  it('a retired repository\'s policy blocks no revocation (R-BTN-57, R-BTN-47)', async () => {
    await aLiveRepository();
    await setPolicySigningKey();
    const breakGlass = await makeKey('ssh-ed25519', 'retire-break-glass');
    await setHumanKeys(breakGlass);
    // A human-only key H, an owner of ops, its approvers.trust naming it alone; opsOwner's
    // approvers.policy naming opsOwner alone (S-BTN-192's shape).
    const h = await makeKey('ssh-ed25519', 'ops-human');
    const blob = await sshsig(breakGlass, new TextEncoder().encode(h.publicKey.trim()), 'baton-human-keys@1');
    expect((await signed(breakGlass, '/v1/human-keys', { public_key: h.publicKey, signature: btoa(String.fromCharCode(...blob)) })).status).toBe(200);
    expect((await keyCall(opsOwner, '/v1/owner/ops/owners', { public_key: h.publicKey })).status).toBe(200);
    const cur = (await rows<{ version: number; policy_json: string }>('SELECT version, policy_json FROM repository_policies WHERE repository_id = ? ORDER BY version DESC LIMIT 1', 'ops'))[0];
    const doc = JSON.parse(cur.policy_json) as Record<string, unknown> & { approvers: Record<string, string[]> };
    const put = await keyCall(opsOwner, '/v1/owner/ops/policy', {
      base_version: cur.version,
      policy: { ...doc, approvers: { ...doc.approvers, policy: [`key:${opsOwner.fingerprint}`], trust: [`key:${h.fingerprint}`] } },
    }, 'PUT');
    expect(put.status, JSON.stringify(await put.clone().json())).toBe(200);
    // While ops is live, each list blocks the revocation of the key that alone satisfies it —
    // the refusal the round found (R-BTN-188).
    const adminRevoke = await keyCall(admin, `/v1/admin/keys/${encodeURIComponent(opsOwner.fingerprint)}/revoke`, {});
    expect(await code(adminRevoke)).toBe('unsatisfiable-approvers');
    expect(((await adminRevoke.json()) as { list: string }).list).toBe('approvers.policy');
    const humanRevoke = await signed(breakGlass, '/v1/human-keys', { fingerprint: h.fingerprint, revoke: true, confirm: true });
    expect(((await humanRevoke.clone().json()) as { code: string }).code).toBe('unsatisfiable-approvers');
    // Retired, the same rows block nothing: no route can change the policy again, so it never
    // holds a revocation (R-BTN-47). Both keys revoke — their owner rows go with them.
    expect((await retire()).status).toBe(200);
    expect((await keyCall(admin, `/v1/admin/keys/${encodeURIComponent(opsOwner.fingerprint)}/revoke`, {})).status).toBe(200);
    expect((await signed(breakGlass, '/v1/human-keys', { fingerprint: h.fingerprint, revoke: true, confirm: true })).status).toBe(200);
    expect(await rows(`SELECT removed_at, revoked_at FROM repository_owners WHERE repository_id = 'ops' AND fingerprint = ?`, opsOwner.fingerprint))
      .toEqual([{ removed_at: T0, revoked_at: T0 }]);
    // The owner of two repositories keeps its row on ops — only the revoked keys' go.
    expect(await rows(`SELECT count(*) AS n FROM repository_owners WHERE repository_id = 'ops' AND removed_at IS NULL`)).toEqual([{ n: 1 }]);
    expect(await rows(`SELECT revoked_at FROM human_keys WHERE fingerprint = ?`, h.fingerprint)).toEqual([{ revoked_at: T0 }]);
  });

  it('a claim naming a retired repository\'s ticket is not-found, before the cutover gate (R-BTN-47)', async () => {
    await aLiveRepository();
    await retire();
    // Every live repository un-cut-over: docs never did, and baton (the seeded cut-over) and ops
    // are retired — so the claim's cutover gate would refuse first if it ran first.
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', retire: true, confirm: true })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'baton', retire: true, confirm: true })).status).toBe(200);
    const w = await register('vm-a');
    const retired = await claimItem('vm-a', w.secret, { ticket_id: 'ops:T-1' });
    expect(retired.json.code).toBe('not-found');
    // A wanted claim naming a repository never registered answers the same — as one never
    // registered (a disclosure of this change: the cutover gate used to answer for it).
    const ghost = await claimItem('vm-a', w.secret, { ticket_id: 'ghost:T-9' });
    expect(ghost.json.code).toBe('not-found');
  });
});
