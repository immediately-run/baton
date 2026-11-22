// S-BTN-50 owner state exported (BATON_SPEC §15, §4.8 R-BTN-88; R3-1258): the tenant's
// administrator moves a Baton — freeze, seal, export, import. Must hold, for the sections that
// exist when this lands: refusals before the seal (frozen claims and owner writes, a lagging
// mirror, a fence-pending claim the seal names until an administrator's clear — accepted while
// frozen — lets it proceed); identical exports over exactly the owner state; the sealed source
// serving nothing but an administrator's read; the import restoring the state into an empty
// Baton, continuing the event sequence, the runners resuming unkeyed and re-heartbeating; a
// tampered import and a second one refused. The unit half (the digest, the section list, the
// pending rows) is test/unit/ownerState.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, claimItem, course, cutover, Git, keyCall, makeApiKey, mirrorCall, placed, register, rows, setAdminKeys, setClock, setHumanKeys, sessionCall, withCore } from '../helpers';
import { makeKey, sshsig, type TestKey } from '../lib/sshKeys';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { SECTIONS } from '../../src/core/ownerState';
import { canonicalJson, sha256HexSync } from '../../src/core/policy';

const T0 = Date.parse('2026-11-18T12:00:00Z');

let admin: TestKey;
let owner: TestKey;
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner-of-docs');
  await setAdminKeys(admin);
  await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] });
  git = new Git().add('A', {}, placed('filed', [], [['implement', 'ready']])).add('B', {}, placed('filed', [], [['implement', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
});

const adminPost = (path: string, body: unknown = {}) => keyCall(admin, path, body);
const withDigest = (backup: Record<string, unknown>) => ({ ...backup, digest: sha256HexSync(canonicalJson(backup)) });

/** Empty the instance for an import (§4.8): the harness fabricates a fresh Baton, as the move's
 *  target is one; the policy log's append-only triggers (R-BTN-188) go for the wipe alone. */
async function wipe() {
  await rows('DROP TRIGGER IF EXISTS repository_policies_no_update');
  await rows('DROP TRIGGER IF EXISTS repository_policies_no_delete');
  for (let pass = 0; pass < 20; pass++) {
    const tables = (await rows<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_baton_%' AND name NOT LIKE '_cf_%' AND name != 'state_version'`)).map((t) => t.name);
    let stuck = 0;
    for (const t of tables) {
      try {
        await rows(`DELETE FROM "${t}"`);
      } catch {
        stuck++; // a foreign key waits for its parent — the next pass takes it
      }
    }
    if (!stuck) return;
  }
  throw new Error('the wipe could not empty the instance');
}

describe('S-BTN-50 owner state exported (R3-1258)', () => {
  it('preserves protected policy versions, floors and registered human keys on a move', async () => {
    const root = await makeKey('ssh-ed25519', 'test-break-glass');
    const human = await makeKey('ssh-ed25519', 'test-human');
    await setHumanKeys(root);
    const blob = await sshsig(root, new TextEncoder().encode(human.publicKey.trim()), 'baton-human-keys@1');
    expect((await keyCall(root, '/v1/human-keys', { public_key: human.publicKey, signature: btoa(String.fromCharCode(...blob)) })).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/docs/owners', { public_key: human.publicKey })).status).toBe(200);
    const path = '/v1/repositories/docs/policy';
    expect((await keyCall(owner, '/v1/owner/docs/policy', { base_version: 1, preset: 'protected' }, 'PUT')).status).toBe(200);
    expect((await keyCall(human, '/v1/owner/docs/policy/floors', { name: 'human-only', guarantees: ['human-gates'] })).status).toBe(200);
    const before = (await keyCall(owner, path)).json;
    const versions = await rows('SELECT * FROM repository_policies ORDER BY repository_id, version');
    const keys = await rows('SELECT * FROM human_keys ORDER BY fingerprint');
    expect(keys).toHaveLength(1);
    expect((await adminPost('/v1/admin/freeze')).status).toBe(200);
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await adminPost('/v1/admin/seal')).status).toBe(200);
    const exported = (await keyCall(admin, '/v1/admin/export')).json;
    await wipe();
    await setClock(T0 + 60_000);
    const { digest: _digest, ...backup } = exported;
    const versionsWithoutFirst = versions.filter((r) => r.repository_id !== 'docs' || r.version !== 1);
    for (const [policies, message] of [
      [versions.filter((r) => r.repository_id !== 'docs'), 'no policy'],
      [versionsWithoutFirst, 'versions must chain'],
      [versions.map((r) => r.repository_id === 'docs' && r.version === 2 ? { ...r, previous_hash: null } : r), 'versions must chain'],
      [versions.map((r) => r.repository_id === 'docs' && r.version === 2 ? { ...r, hash: '0'.repeat(64) } : r), 'does not match'],
    ] as const) {
      const incomplete = { ...backup, sections: { ...backup.sections, repository_policies: policies } };
      const response = await adminPost('/v1/admin/import', withDigest(incomplete));
      expect(response.json.code).toBe('invalid-params');
      expect(JSON.stringify(response.json)).toContain(message);
      expect(await rows('SELECT id FROM repositories')).toEqual([]);
    }
    const badFloor = { ...backup, sections: { ...backup.sections, policy_floors: [
      { ...backup.sections.policy_floors[0], guarantees: '["human-gates-hardware"]' },
    ] } };
    expect((await adminPost('/v1/admin/import', withDigest(badFloor))).json.code).toBe('floor-violated');
    for (const table of ['repositories', 'repository_policies', 'policy_floors', 'human_keys']) {
      expect(await rows(`SELECT * FROM ${table}`)).toEqual([]);
    }

    // The destination must not assign the imported human key its administrator role too.
    await setAdminKeys(admin, human);
    expect((await adminPost('/v1/admin/import', exported)).json.code).toBe('invalid-params');
    expect(await rows('SELECT id FROM repositories')).toEqual([]);
    await setAdminKeys(admin);
    expect((await adminPost('/v1/admin/import', exported)).status).toBe(200);
    const after = await keyCall(owner, path);
    expect(after.status).toBe(200);
    expect({ version: after.json.version, hash: after.json.hash, floors: after.json.floors, keys: (await rows('SELECT * FROM human_keys')).length })
      .toEqual({ version: 2, hash: before.hash, floors: before.floors, keys: 1 });
    expect(await rows('SELECT * FROM repository_policies ORDER BY repository_id, version')).toEqual(versions);
    expect(await rows('SELECT * FROM human_keys ORDER BY fingerprint')).toEqual(keys);
  });

  it('keeps a person-leg arrival claimable across two moves and a stale first post', async () => {
    const person = {
      ...roadmapPr,
      legs: { ...roadmapPr.legs, decide: { from: ['reviewed'], to: ['adjudicated'], kind: 'person', asks: 'owner' } },
    };
    const registry = [course(4, 4, { course: person })];
    const question = { id: 'q-1', options: [{ id: 'ship', reached: 'adjudicated' }] };
    const stale = placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['decide', 'ready']]);
    git.registry = registry;
    git.add('A', { question }, stale);
    expect((await git.post()).status).toBe(200);
    expect((await keyCall(owner, '/v1/repositories/docs/attestations', {
      type: 'std:decision@1', subject: { ticket: 'A' }, value: { option: 'ship' },
    })).status).toBe(200);
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await adminPost('/v1/admin/seal')).status).toBe(200);
    const backup = (await keyCall(admin, '/v1/admin/export')).json;
    expect(backup.sections.ticket_stations).toMatchObject([{ ticket_id: 'docs:A', station: 'adjudicated', next_source: 'baton' }]);
    await wipe();
    await setClock(T0 + 60_000);
    expect((await adminPost('/v1/admin/import', backup)).status).toBe(200);
    expect(await rows('SELECT * FROM ticket_stations')).toEqual([]);
    expect((await adminPost('/v1/admin/freeze')).status).toBe(200);
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await adminPost('/v1/admin/seal')).status).toBe(200);
    const secondBackup = (await keyCall(admin, '/v1/admin/export')).json;
    expect(secondBackup.sections.ticket_stations).toEqual(backup.sections.ticket_stations);
    await wipe();
    await setClock(T0 + 120_000);
    expect((await adminPost('/v1/admin/import', secondBackup)).status).toBe(200);
    const target = new Git().add('A', { question }, stale);
    target.registry = registry;
    expect((await target.post()).status).toBe(200);
    expect(await rows('SELECT station, next_source FROM ticket_stations WHERE ticket_id = ?', 'docs:A'))
      .toEqual([{ station: 'adjudicated', next_source: 'baton' }]);
    expect(await rows('SELECT * FROM pending_owner_state')).toEqual([]);
    const runner = await register('vm-a', { courses: [{ repository: 'docs', course: 'roadmap-pr', version: 4 }] });
    const claim = await claimItem('vm-a', runner.secret);
    expect(claim.status, JSON.stringify(claim.json)).toBe(200);
    expect(claim.json).toMatchObject({ ticket_id: 'docs:A', station: 'adjudicated', legs: ['merge'] });
  });

  it('preserves the SQL NULL session-host reset and refuses JSON null text', async () => {
    const setHosts = (session_hosts: string[] | null) => keyCall(admin, '/v1/admin/settings', { session_hosts }, 'PUT');
    expect((await setHosts(['example.test'])).status).toBe(200);
    expect((await setHosts(null)).status).toBe(200);
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await adminPost('/v1/admin/seal')).status).toBe(200);
    const exported = (await keyCall(admin, '/v1/admin/export')).json;
    const { digest: _digest, ...backup } = exported;
    expect(backup.sections.instance_settings[0].session_hosts).toBeNull();
    await wipe();
    await setClock(T0 + 60_000);
    const invalid = { ...backup, sections: { ...backup.sections, instance_settings: [
      { ...backup.sections.instance_settings[0], session_hosts: 'null' },
    ] } };
    expect((await adminPost('/v1/admin/import', withDigest(invalid))).json.code).toBe('invalid-params');
    expect((await adminPost('/v1/admin/import', exported)).status).toBe(200);
    expect(await rows('SELECT session_hosts FROM instance_settings')).toEqual([{ session_hosts: null }]);
    const state = await keyCall(admin, '/v1/admin/state');
    expect(state.json.instance.session_hosts).toEqual(['claude.ai']);
  });

  it('a fence-pending claim holds the seal; the clear is accepted while frozen, and the seal then proceeds; a lagging mirror is named and dispatched', async () => {
    const sent = await import('../helpers').then((h) => h.captureDispatches());
    const w = await register('vm-a');
    const c = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })).json;
    // The freeze goes in first: claims and owner writes refuse through it, the administrator acts.
    expect((await adminPost('/v1/admin/freeze')).status).toBe(200);
    expect((await claimItem('vm-a', w.secret, { ticket_id: 'docs:B' })).json.code).toBe('frozen');
    // A force-reap fences the claim; the fence holds the seal.
    await sessionCall(await adminSession(admin), `/v1/ui/claims/${c.claim_id}/reap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
    const fenced = await adminPost('/v1/admin/seal');
    expect(fenced.status).toBe(409);
    expect(fenced.json.claims[0]).toMatchObject({ ticket_id: 'docs:A', fence_pending: true });
    // The administrator's fence clear is accepted WHILE FROZEN (§4.8: the freeze refuses new
    // claims and owner writes, never the administrator's own acts).
    const confirm = await sessionCall(await adminSession(admin), `/v1/ui/claims/${c.claim_id}/fence-clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
    expect([confirm.status, await confirm.clone().text().then((t) => t.slice(0, 40))].join(' ')[0]).toBe('2');
    // The mirror has read nothing: the seal names it and dispatches its workflow.
    const lagging = await adminPost('/v1/admin/seal');
    expect(lagging.status).toBe(409);
    expect(lagging.json.lagging_mirrors).toEqual(['docs']);
    expect(sent).toContain('docs:mirror');
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await adminPost('/v1/admin/seal')).status).toBe(200);
  });

  it('the export is identical over exactly the owner state; the source serves nothing but an administrator\'s read; a tampered and a second import are refused', async () => {
    expect((await keyCall(admin, '/v1/admin/capacities', { capability: 'device:test', capacity: 2 }, 'PUT')).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/settings', { link_hosts: ['example.test'], session_hosts: [] }, 'PUT')).status).toBe(200);
    // Owner state worth keeping: a grant with a role and a domain, a bar, a hold, a reading.
    const granted = await makeKey('ssh-ed25519', 'granted');
    expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: granted.publicKey, hostname: 'g-1', capabilities: ['agent-venue'] })).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/docs/bars', { course: '*', tag: 'family:glm', legs: [], applies: 'claim', reason: 'glm-down' })).status).toBe(200);
    expect((await sessionCall(await adminSession(admin), '/v1/ui/overrides/docs:A', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hold: true }) })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'corp-vpn', scope: 'account', detail_schema: { type: 'object' } })).status).toBe(200);
    const inst = await keyCall(admin, '/v1/admin/instances', { name: 'vpn-1', serves: ['corp-vpn'], repositories: ['docs'] });
    expect(inst.status).toBe(200);
    const reading = await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'vpn-1', kind: 'state', available: true, valid_for: 3600 }] });
    expect(reading.status).toBe(200);
    const w = await register('vm-a');
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await adminPost('/v1/admin/seal')).status).toBe(200);
    const first = (await keyCall(admin, '/v1/admin/export')).json;
    const second = (await keyCall(admin, '/v1/admin/export?with_history=1')).json;
    expect(second).not.toEqual(first); // --with-history adds the history sections
    const again = (await keyCall(admin, '/v1/admin/export')).json;
    expect(again).toEqual(first);
    expect(Object.keys(first.sections).sort()).toEqual(SECTIONS.map((s) => s.table).sort());
    // The sealed source: everything but an administrator's read is refused `sealed` — the sync's
    // board post and a runner's first heartbeat alike.
    const posted = await git.post();
    expect(posted.status).toBe(503);
    expect((posted as { code?: string }).code).toBe('sealed');
    await expect(register('vm-b')).rejects.toThrow(/sealed/);
    void w;

    // The import on the target (an empty Baton, fabricated by the wipe).
    await wipe();
    await setClock(T0 + 5 * 60_000);
    await rows("INSERT INTO instance_settings (id, link_hosts) VALUES (1, '[]')");
    expect((await adminPost('/v1/admin/import', { ...first, digest: '0'.repeat(64) })).json.code).toBe('invalid-params');
    expect((await adminPost('/v1/admin/import', first)).status).toBe(200);
    expect((await adminPost('/v1/admin/import', first)).json.code).toBe('conflict');
    // The state stands: the grant with its expanded capabilities, the bar, the reading, the repository.
    expect((await rows<{ capabilities: string }>('SELECT capabilities FROM runner_grants')).map((r) => JSON.parse(r.capabilities) as string[])).toContainEqual(expect.arrayContaining(['create-pr', 'llm-call']));
    expect((await rows<{ reason: string }>('SELECT reason FROM owner_bars')).map((r) => r.reason)).toContainEqual('glm-down');
    expect((await rows<{ instance: string; available: number }>('SELECT instance, available FROM instance_readings')).map((r) => [r.instance, r.available])).toContainEqual(['vpn-1', 1]);
    expect((await rows<{ id: string }>('SELECT id FROM repositories')).map((r) => r.id).sort()).toEqual(['baton', 'docs']);
    expect(await rows('SELECT * FROM capability_capacity')).toEqual(first.sections.capability_capacity);
    expect(await rows('SELECT * FROM instance_settings')).toEqual(first.sections.instance_settings);
    // The hold waits for the ticket's first snapshot, then applies.
    expect((await rows('SELECT 1 FROM ticket_overrides')).length).toBe(0);
    git = new Git().add('A', {}, placed('filed', [], [['implement', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect((await rows<{ hold: number }>('SELECT hold FROM ticket_overrides WHERE ticket_id = ?', 'docs:A'))[0].hold).toBe(1);
    // The event sequence continues from the export's floor.
    expect((await rows<{ n: number }>('SELECT MAX(seq) AS n FROM events'))[0].n).toBeGreaterThanOrEqual(first.events_seq);
    // The runner resumes unkeyed and re-heartbeats with its secret.
    expect((await rows<{ last_seen_at: number }>('SELECT last_seen_at FROM runners')).every((r) => r.last_seen_at === 0)).toBe(true);
    const beat = await import('../helpers').then((h) => h.beat('vm-a', w.secret));
    expect(beat.status).toBe(200);
    expect(beat.json.runner_id).toBe(w.id);
    // The day's usage is the target's own (R-BTN-2): the counters were never imported.
    expect((await withCore((c) => c.capacity.usage())).requests).toBeLessThan(10);
  });

  it('an API-key administrator drives the move the same way', async () => {
    const key = await makeApiKey('an administrator\'s API key');
    await setAdminKeys(key.line);
    // The freeze first — its event is the last the mirror must acknowledge (§4.8's order).
    expect((await import('../helpers').then((h) => h.apiKeyCall(key.key, '/v1/admin/freeze', {}))).status).toBe(200);
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await import('../helpers').then((h) => h.apiKeyCall(key.key, '/v1/admin/seal', {}))).status).toBe(200);
    expect((await import('../helpers').then((h) => h.apiKeyCall(key.key, '/v1/admin/state'))).status).toBe(200);
  });
});
