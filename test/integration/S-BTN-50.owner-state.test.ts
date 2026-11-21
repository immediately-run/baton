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
import { adminSession, claimItem, cutover, endClaim, Git, keyCall, makeApiKey, mirrorCall, placed, register, rows, setAdminKeys, setClock, sessionCall, tick, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { sha256HexSync } from '../../src/core/policy';
import { SECTIONS } from '../../src/core/ownerState';

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

  it('lets a pull-only mirror reach the seal even when no local mirror-written events are pending', async () => {
    await rows("UPDATE repositories SET dispatch = NULL WHERE id = 'docs'");
    expect(await (await mirrorCall('/v1/sync/wanted')).json()).toMatchObject({ wanted: false });
    expect((await adminPost('/v1/admin/freeze')).status).toBe(200);
    expect(await (await mirrorCall('/v1/sync/wanted')).json()).toMatchObject({ wanted: true });
    expect((await adminPost('/v1/admin/seal')).json.lagging_mirrors).toEqual(['docs']);
    const { next } = await (await mirrorCall('/v1/sync/events')).json() as { next: number };
    await mirrorCall(`/v1/sync/events?after=${next}`);
    expect(await (await mirrorCall('/v1/sync/wanted')).json()).toMatchObject({ wanted: false });
    expect((await adminPost('/v1/admin/seal')).status).toBe(200);
  });

  it('the export is identical over exactly the owner state; the source serves nothing but an administrator\'s read; a tampered and a second import are refused', async () => {
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
    const exportedRepo = first.sections.repositories.find((r: { id: string }) => r.id === 'docs');
    expect(exportedRepo).not.toHaveProperty('sync_wanted_at');
    expect(exportedRepo).not.toHaveProperty('sync_wanted_after');
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
    expect((await adminPost('/v1/admin/import', { ...first, digest: '0'.repeat(64) })).json.code).toBe('invalid-params');
    const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
      : v && typeof v === 'object' ? `{${Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`).join(',')}}` : JSON.stringify(v);
    for (const overrides of [
      { dispatch: JSON.stringify({ kind: 'github-app', token: 'not-runtime-config' }) },
      { unblocked_trigger: JSON.stringify({ kind: 'gitlab-trigger', project_id: 99, ref: 'main' }) },
    ]) {
      const { digest: _digest, ...changed } = structuredClone(first);
      Object.assign(changed.sections.repositories.find((r: { id: string }) => r.id === 'docs'), overrides);
      const refused = await adminPost('/v1/admin/import', { ...changed, digest: sha256HexSync(canonical(changed)) });
      expect(refused.json).toMatchObject({ code: 'invalid-params', message: expect.stringMatching(/dispatch|unblocked_trigger/) });
      expect(await rows('SELECT id FROM repositories')).toEqual([]);
    }
    expect((await adminPost('/v1/admin/import', first)).status).toBe(200);
    expect(await rows(`SELECT sync_wanted_at, sync_wanted_after FROM repositories WHERE id = 'docs'`)).toEqual([{ sync_wanted_at: null, sync_wanted_after: null }]);
    expect((await adminPost('/v1/admin/import', first)).json.code).toBe('conflict');
    // The state stands: the grant with its expanded capabilities, the bar, the reading, the repository.
    expect((await rows<{ capabilities: string }>('SELECT capabilities FROM runner_grants')).map((r) => JSON.parse(r.capabilities) as string[])).toContainEqual(expect.arrayContaining(['create-pr', 'llm-call']));
    expect((await rows<{ reason: string }>('SELECT reason FROM owner_bars')).map((r) => r.reason)).toContainEqual('glm-down');
    expect((await rows<{ instance: string; available: number }>('SELECT instance, available FROM instance_readings')).map((r) => [r.instance, r.available])).toContainEqual(['vpn-1', 1]);
    expect((await rows<{ id: string }>('SELECT id FROM repositories')).map((r) => r.id).sort()).toEqual(['baton', 'docs']);
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
