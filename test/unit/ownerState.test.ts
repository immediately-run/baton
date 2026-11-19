// ownerState.test.ts — R3-1258's unit half of owner state (BATON_SPEC §4.8 R-BTN-88, G-BTN-78):
// freeze, seal (its claims and lagging mirrors), the deterministic export over one section
// list with its RFC 8785 digest, and the import — one transaction into an empty Baton, the
// event sequence continued, runners resuming unkeyed, and the ticket-scoped rows waiting in
// `pending_owner_state` for the first snapshot that creates their ticket. The integration half
// is S-BTN-50.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, adminSession, keyCall, mirrorCall, rows, setAdminKeys, setClock, sessionCall, syncCall, tick, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { SECTIONS, OWNER_STATE_FORMAT } from '../../src/core/ownerState';

const T0 = Date.parse('2026-11-18T12:00:00Z');

let admin: TestKey;
let owner: TestKey;
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] });
  git = new Git().add('A');
  expect((await git.post()).status).toBe(200);
});

const state = () => withCore((c) => c.ownerState);
const call = async (path: string, body?: unknown, method?: string) => keyCall(admin, path, body, method);

/** An owner's hold on a ticket (§6: the dashboard's write, under an owner session). */
async function hold(ticket: string) {
  return sessionCall(await adminSession(admin), `/v1/ui/overrides/${encodeURIComponent(ticket)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hold: true }) });
}

/** Empty the instance for an import (§4.8): every user table, children first, the migration
 *  ledger and the state version kept. The policy log is append-only by trigger (R-BTN-188), so
 *  the harness alone drops its two triggers for the wipe — an honest target is a FRESH Baton,
 *  and the test fabricates one; `start()` re-arms nothing the import needs. */
async function wipe() {
  await rows('DROP TRIGGER IF EXISTS repository_policies_no_update');
  await rows('DROP TRIGGER IF EXISTS repository_policies_no_delete');
  let stuck: string[] = [];
  for (let pass = 0; pass < 20; pass++) {
    const tables = (await rows<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_baton_%' AND name NOT LIKE '_cf_%' AND name != 'state_version'`)).map((t) => t.name);
    stuck = [];
    for (const t of tables) {
      try {
        await rows(`DELETE FROM "${t}"`);
      } catch (e) {
        stuck.push(`${t}: ${String(e).slice(0, 100)}`); // a foreign key waits for its parent — the next pass takes it
      }
    }
    if (!stuck.length) return;
  }
  throw new Error(`the wipe could not empty the instance: ${stuck.join(' | ')}`);
}

describe('R-BTN-88: freeze and seal', () => {
  it('freeze refuses new claims and owner writes; unfreeze undoes both; the administrator acts through it', async () => {
    expect((await call('/v1/admin/freeze', {})).status).toBe(200);
    // An owner write and a claim are refused `frozen`; the administrator's own acts are not.
    expect((await keyCall(owner, '/v1/owner/docs/bars', { course: '*', tag: 'x', legs: [], applies: 'claim', reason: 'why' })).json.code).toBe('frozen');
    const w = await import('../helpers').then((h) => h.register('vm-a'));
    expect((await import('../helpers').then((h) => h.claimItem('vm-a', w.secret, { ticket_id: 'docs:A' }))).json.code).toBe('frozen');
    expect((await call('/v1/admin/state')).status).toBe(200);
    expect((await call('/v1/admin/unfreeze', {})).status).toBe(200);
    const claim = await import('../helpers').then((h) => h.cutover(1).then(() => h.claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })));
    expect(claim.status).toBe(200);
  });

  it('seal refuses while a claim is active, naming it; while a mirror lags, naming it and dispatching it', async () => {
    const h = await import('../helpers');
    await h.cutover(1);
    const w = await h.register('vm-a');
    expect((await h.claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })).status).toBe(200);
    const held = await call('/v1/admin/seal', {});
    expect(held.status).toBe(409);
    expect(held.json.code).toBe('conflict');
    expect(held.json.claims[0]).toMatchObject({ ticket_id: 'docs:A' });
    // The claim ends; the mirror has read nothing — the seal names docs and dispatches it.
    const claimId = (await rows<{ id: number }>(`SELECT id FROM claims WHERE status = 'active'`))[0].id;
    expect((await h.endClaim('vm-a', w.secret, claimId, { end_reason: 'released:requested' })).status).toBe(200);
    const sent = await h.captureDispatches();
    const lagging = await call('/v1/admin/seal', {});
    expect(lagging.status).toBe(409);
    expect(lagging.json.lagging_mirrors).toEqual(['docs']);
    expect(sent).toContain('docs:mirror');
    // The mirror acknowledges the log: the seal proceeds.
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await call('/v1/admin/seal', {})).status).toBe(200);
    const events = await rows<{ kind: string }>('SELECT kind FROM events ORDER BY seq');
    expect(events[events.length - 1].kind).toBe('sealed');
  });

  it('a sealed Baton serves an administrator\'s reads alone, and its alarm idles', async () => {
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await call('/v1/admin/seal', {})).status).toBe(200);
    const posted = await git.post();
    expect(posted.status).toBe(503);
    expect((posted as { code?: string }).code).toBe('sealed');
    expect((await syncCall('/v1/sync/head')).status).toBe(503);
    expect((await call('/v1/admin/state')).status).toBe(200);
    const before = (await rows<{ n: number }>('SELECT COUNT(*) AS n FROM events'))[0].n;
    await tick();
    expect((await rows<{ n: number }>('SELECT COUNT(*) AS n FROM events'))[0].n).toBe(before);
  });
});

describe('R-BTN-88: the export', () => {
  beforeEach(async () => {
    // A hold (an override — the ticket-scoped section), a bar, a grant and a reading: each
    // section a row, beside the registered repository and its owners.
    expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: (await makeKey('ssh-ed25519', 'granted')).publicKey, hostname: 'g', capabilities: ['agent-venue'] })).status).toBe(200);
    expect((await hold('docs:A')).status).toBe(200);
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await call('/v1/admin/seal', {})).status).toBe(200);
  });

  it('is sealed only', async () => {
    await withCore((c) => c.store.exec(`DELETE FROM baton_settings WHERE key = 'sealed_at'`));
    expect(((await call('/v1/admin/export')).json as { code?: string }).code).toBe('conflict');
  });

  it('is deterministic and complete over its one section list, with the RFC 8785 digest', async () => {
    const first = (await call('/v1/admin/export')).json;
    const second = (await call('/v1/admin/export')).json;
    expect(second).toEqual(first);
    expect(first.format).toBe(OWNER_STATE_FORMAT);
    expect(first.exported_at).toBe(Number((await rows<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'sealed_at'`))[0].value));
    // G-BTN-78: exactly R-BTN-88's sections — the one list beside the exporter.
    expect(Object.keys(first.sections).sort()).toEqual([...SECTIONS.map((s) => s.table)].sort());
    // The digest is over the RFC 8785 canonical JSON of the rest: sorted keys, whatever order
    // the exporter's own objects arrived in.
    const { digest, ...rest } = first;
    const canonical = (v: unknown): string =>
      typeof v === 'number' ? (v === 0 ? '0' : String(v))
        : Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
        : v != null && typeof v === 'object' ? `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
        : JSON.stringify(v);
    const { sha256HexSync } = await import('../../src/core/policy');
    expect(digest).toBe(sha256HexSync(canonical(rest)));
    // Every section's rows are there, with the tables' own columns.
    for (const s of SECTIONS) {
      const columns = (await rows<{ name: string }>(`PRAGMA table_info(${s.table})`)).map((c) => c.name);
      for (const row of first.sections[s.table]) for (const k of Object.keys(row)) expect(columns).toContain(k);
    }
    expect(first.sections.repositories.map((r: Record<string, unknown>) => r.id)).toContain('docs');
    expect(first.sections.ticket_overrides.map((r: Record<string, unknown>) => r.ticket_id)).toContain('docs:A');
  });
});

describe('R-BTN-88: the import', () => {
  it('restores the owner state into an empty Baton, continues the event sequence, unkeys the runners, and refuses a second import', async () => {
    const h = await import('../helpers');
    // A runner to carry: its row exports and resumes unkeyed (§4.8).
    await h.register('vm-a');
    expect((await hold('docs:A')).status).toBe(200);
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await call('/v1/admin/seal', {})).status).toBe(200);
    const ex = (await call('/v1/admin/export')).json;
    await wipe();
    // A tampered digest, a wrong format and a wrong schema_version are each refused, writing nothing.
    expect((await call('/v1/admin/import', { ...ex, digest: '0'.repeat(64) })).json.code).toBe('invalid-params');
    expect((await call('/v1/admin/import', { ...ex, format: 'baton.owner-state/v2' })).json.code).toBe('invalid-params');
    expect((await call('/v1/admin/import', { ...ex, schema_version: ex.schema_version + 1 })).json.code).toBe('invalid-params');
    expect((await rows('SELECT 1 FROM repositories LIMIT 1')).length).toBe(0);
    // The good import lands whole.
    expect((await call('/v1/admin/import', ex)).status).toBe(200);
    expect((await rows<{ id: string }>('SELECT id FROM repositories')).map((r) => r.id)).toEqual(['baton', 'docs']);
    // The override waits: its ticket is not on the board until a snapshot posts it.
    expect((await rows('SELECT 1 FROM ticket_overrides')).length).toBe(0);
    expect((await rows<{ ticket_id: string }>('SELECT ticket_id FROM pending_owner_state')).map((r) => r.ticket_id)).toEqual(['docs:A']);
    // The event sequence continues from the export's events_seq.
    const seq = (await rows<{ n: number }>('SELECT MAX(seq) AS n FROM events'))[0].n;
    expect(seq).toBeGreaterThanOrEqual(ex.events_seq);
    // The runners resume unkeyed.
    expect((await rows<{ last_seen_at: number }>('SELECT last_seen_at FROM runners')).every((r) => r.last_seen_at === 0)).toBe(true);
    // A request signed at the source's sealed_at is a captured one replayed: refused (§4.8).
    expect((await call('/v1/admin/import', ex)).json.code).toBe('unauthenticated');
    // A second import into the now-non-empty Baton is refused — signed after the floor.
    await setClock(T0 + 5 * 60_000);
    expect((await call('/v1/admin/import', ex)).json.code).toBe('conflict');
    git = new Git().add('A');
    expect((await git.post()).status).toBe(200);
    expect((await rows<{ hold: number }>('SELECT hold FROM ticket_overrides WHERE ticket_id = ?', 'docs:A'))[0].hold).toBe(1);
    expect((await rows('SELECT 1 FROM pending_owner_state')).length).toBe(0);
  });

  it('drops and logs a pending row the repository\'s first snapshot does not post', async () => {
    expect((await hold('docs:A')).status).toBe(200);
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await call('/v1/admin/seal', {})).status).toBe(200);
    const ex = (await call('/v1/admin/export')).json;
    await wipe();
    expect((await call('/v1/admin/import', ex)).status).toBe(200);
    // The first snapshot posts a different ticket: A's pending override is dropped and logged.
    git = new Git().add('B');
    expect((await git.post()).status).toBe(200);
    expect((await rows('SELECT 1 FROM pending_owner_state')).length).toBe(0);
    const dropped = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'imported' AND json_extract(detail_json, '$.act') = 'pending-dropped'`);
    expect(dropped.map((d) => (JSON.parse(d.detail_json) as { ticket: string }).ticket)).toEqual(['docs:A']);
  });
});
