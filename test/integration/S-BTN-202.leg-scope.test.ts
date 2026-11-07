// S-BTN-202 a leg's scope (BATON_SPEC §15 S-BTN-202, §12.9; B-134, OWASP ASI10 hole 7): a leg's
// pushes outside its ticket's scope are reported and optionally held, and a worker push no open
// claim covers is found from the forge's own delivery. Must hold: the claim answer carries the
// ticket's scope (its home and its `repos:`, a short name read under the home's owner as
// R-BTN-92 reads it); a leg's report of an out-of-scope push raises one `scope-exceeded`
// finding under Needs you and one event, an in-scope action none; with the owners'
// `scope_policy: hold` the ticket is held `scope-exceeded` until an owner lifts the hold, and a
// resolved finding leaves the listing; a push delivery by a login of the repository's
// `worker_pushers` while no active claim covers it raises one `unclaimed-write` finding on the
// repository, one by an unnamed login none, and one covered by an open claim none. The runner's
// half — reading the home checkout's refs around each leg — is unit-tested beside the runner.
// Runs on both hosts.
import { describe, it, expect, inject, beforeEach } from 'vitest';
import { advance, adminSession, claimItem, cutover, endClaim, keyCall, ORIGIN, payload, register, rows, sessionCall, setAdminKeys, setClock, syncCall, syncToken, webhookCall } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const board = inject('board');
const T0 = Date.parse('2026-11-07T12:00:00Z');
const fixture = board.states.A.state.items[0] as Record<string, unknown>;
const FIELDHOUSE_SHA = 'a'.repeat(40);
let admin: TestKey;
let fieldOwner: TestKey;
let docsOwner: TestKey;
/** The administrator's dashboard session, for `/v1/ui/*` reads and actions. */
let session: string;

/** fieldhouse's sync token, for its own board. */
const fieldhouseToken = () => syncToken({
  repository: 'immediately-run/fieldhouse', ref: 'refs/heads/main',
  job_workflow_ref: 'immediately-run/fieldhouse/.github/workflows/baton-sync.yml@refs/heads/main',
});

/** fieldhouse's board: `F-1` and `F-2` name no other repository (their legs' scope is
 *  fieldhouse alone), `F-3` names docs (a short name under fieldhouse's owner). */
const fieldhouseBoard = (ids: string[], repos: Record<string, string[]>) => ({
  state: { items: ids.map((id) => ({ ...fixture, id, title: `fieldhouse: ${id}`, repos: repos[id] ?? [] })) },
  ready: [...ids],
});

/** One GitHub push delivery to `immediately-run/docs` as `by`, at its own delivery id. */
const pushToDocs = (by: string, id: string) => webhookCall('push', {
  repository: { full_name: 'immediately-run/docs' },
  pusher: { name: by },
  head_commit: { author: { email: `${by}@example.com` } },
}, { id });

/** The Needs-you scope listing. */
const findings = async () => {
  const res = await sessionCall(session, '/v1/ui/state');
  const body = (await res.json()) as Record<string, any>;
  if (body.needs_you == null) throw new Error(`/v1/ui/state ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return (body.needs_you as { scope: { id: number; repository_id: string; ticket_id: string | null; kind: string; target: string }[] }).scope;
};

/** The ticket's override row, for the hold. */
const overrideOf = async (ticket: string) => (await rows<{ hold: number; hold_reason: string | null }>(
  'SELECT hold, hold_reason FROM ticket_overrides WHERE ticket_id = ?', ticket))[0] ?? { hold: 0, hold_reason: null };

/** Register fieldhouse with an owner, post its board and cut it over; give docs an owner too. */
beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  fieldOwner = await makeKey('ssh-ed25519', 'fieldhouse-owner');
  docsOwner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'fieldhouse', github: 'immediately-run/fieldhouse', forge: 'github', remote: 'ssh://git@github.com/immediately-run/fieldhouse',
    default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', sync_keys: [], owner_keys: [fieldOwner.publicKey],
  })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  session = await adminSession(admin);
});

describe('S-BTN-202 a leg\'s scope', () => {
  it('the claim answer carries the ticket\'s scope; a reported push outside it raises one finding and one event, an in-scope action none', async () => {
    expect((await syncCall('/v1/sync/board', payload(FIELDHOUSE_SHA, null, fieldhouseBoard(['F-1'], {})), await fieldhouseToken())).status).toBe(200);
    await cutover(1, 'fieldhouse');
    const w = await register('vm-a', { courses: [{ repository: 'fieldhouse', course: 'roadmap-pr', version: 3 }] });
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'fieldhouse:F-1' });
    // The scope is the ticket's home alone: F-1 names no other repository.
    expect(c.scope).toEqual(['immediately-run/fieldhouse']);
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    // The leg ran, and its runner's audit found two pushes: one to docs (outside), one home
    // (inside — its tracking ref moved too, but the scope covers it).
    expect((await endClaim('vm-a', w.secret, c.claim_id, {
      end_reason: 'released:requested',
      scope_exceeded: [
        { kind: 'push', target: 'immediately-run/docs', ref: 'refs/heads/claude/F-1-x' },
        { kind: 'push', target: 'immediately-run/fieldhouse', ref: 'refs/heads/claude/F-1-y' },
      ],
    })).status).toBe(200);
    expect(await rows(`SELECT ticket_id, claim_id, json_extract(detail_json, '$.target') AS target, json_extract(detail_json, '$.ref') AS ref
                       FROM events WHERE kind = 'scope-exceeded'`)).toEqual([
      { ticket_id: 'fieldhouse:F-1', claim_id: c.claim_id, target: 'immediately-run/docs', ref: 'refs/heads/claude/F-1-x' }]);
    expect(await findings()).toEqual([expect.objectContaining({
      repository_id: 'fieldhouse', ticket_id: 'fieldhouse:F-1', kind: 'scope-exceeded', target: 'immediately-run/docs',
    })]);
    // The default policy is `report`: the finding is listed, the ticket is not held.
    expect(await overrideOf('fieldhouse:F-1')).toEqual({ hold: 0, hold_reason: null });
  });

  it('with scope_policy: hold the ticket is held scope-exceeded until an owner lifts the hold; a resolved finding leaves the listing', async () => {
    expect((await keyCall(fieldOwner, '/v1/owner/fieldhouse/settings', { scope_policy: 'hold' }, 'PUT')).status).toBe(200);
    expect((await syncCall('/v1/sync/board', payload(FIELDHOUSE_SHA, null, fieldhouseBoard(['F-2'], {})), await fieldhouseToken())).status).toBe(200);
    await cutover(1, 'fieldhouse');
    const w = await register('vm-a', { courses: [{ repository: 'fieldhouse', course: 'roadmap-pr', version: 3 }] });
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'fieldhouse:F-2' });
    await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' });
    expect((await endClaim('vm-a', w.secret, c.claim_id, {
      end_reason: 'released:requested', scope_exceeded: [{ kind: 'push', target: 'immediately-run/docs', ref: 'refs/heads/claude/F-2-x' }],
    })).status).toBe(200);
    expect(await overrideOf('fieldhouse:F-2')).toEqual({ hold: 1, hold_reason: 'scope-exceeded' });
    // An owner lifts the hold the way any hold is lifted, and resolves the finding itself.
    const lift = await sessionCall(session, '/v1/ui/overrides/fieldhouse:F-2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hold: false }) });
    expect([lift.status, await lift.text()]).toEqual([200, '{"ok":true}']);
    expect(await overrideOf('fieldhouse:F-2')).toEqual({ hold: 0, hold_reason: null });
    const open = await findings();
    expect(open).toHaveLength(1);
    expect((await sessionCall(session, `/v1/ui/scope/${open[0].id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(200);
    expect(await findings()).toEqual([]);
    // An already-resolved finding resolves no further.
    expect((await sessionCall(session, `/v1/ui/scope/${open[0].id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404);
  });

  it('a worker push no open claim covers is unclaimed-write; a covered one and an unnamed login\'s are nothing', async () => {
    // docs' owners name the fleet's worker login; without a name the cross-check is off.
    expect((await pushToDocs('immediately-run-worker', 'scope-off-0')).status).toBe(204);
    expect(await findings()).toEqual([]);
    expect((await keyCall(docsOwner, '/v1/owner/docs/settings', { worker_pushers: ['immediately-run-worker'] }, 'PUT')).status).toBe(200);
    // No claim is open: the push is uncovered.
    expect((await pushToDocs('immediately-run-worker', 'scope-unclaimed-1')).status).toBe(204);
    expect(await rows(`SELECT repository_id, ticket_id, json_extract(detail_json, '$.pusher') AS pusher FROM events WHERE kind = 'unclaimed-write'`)).toEqual([
      { repository_id: 'docs', ticket_id: null, pusher: 'immediately-run-worker' }]);
    expect(await findings()).toEqual([expect.objectContaining({ repository_id: 'docs', kind: 'unclaimed-write', target: 'immediately-run/docs' })]);
    // A login the owners did not name is a human's push, not the fleet's.
    expect((await pushToDocs('some-human', 'scope-human-2')).status).toBe(204);
    expect(await rows('SELECT count(*) AS n FROM events WHERE kind = \'unclaimed-write\'')).toEqual([{ n: 1 }]);
    // A claim whose ticket\'s scope covers docs — a short `repos:` name under fieldhouse\'s
    // owner — covers the push while it is open.
    expect((await syncCall('/v1/sync/board', payload(FIELDHOUSE_SHA, null, fieldhouseBoard(['F-3'], { 'F-3': ['docs'] })), await fieldhouseToken())).status).toBe(200);
    await cutover(1, 'fieldhouse');
    const w = await register('vm-a', { courses: [{ repository: 'fieldhouse', course: 'roadmap-pr', version: 3 }] });
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'fieldhouse:F-3' });
    expect(c.scope).toEqual(['immediately-run/docs', 'immediately-run/fieldhouse']);
    await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' });
    expect((await pushToDocs('immediately-run-worker', 'scope-covered-3')).status).toBe(204);
    expect(await rows('SELECT count(*) AS n FROM events WHERE kind = \'unclaimed-write\'')).toEqual([{ n: 1 }]);
    // The claim ends: the same push is uncovered again, and the finding — resolved below — is
    // the one open row per shape, updated rather than stacked.
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:requested' })).status).toBe(200);
    expect((await pushToDocs('immediately-run-worker', 'scope-uncovered-4')).status).toBe(204);
    expect(await rows('SELECT count(*) AS n FROM events WHERE kind = \'unclaimed-write\'')).toEqual([{ n: 2 }]);
    expect(await findings()).toHaveLength(1);
  });

  it('a report of actions inside the scope records nothing, and entries that fail their shape are dropped and counted', async () => {
    expect((await syncCall('/v1/sync/board', payload(FIELDHOUSE_SHA, null, fieldhouseBoard(['F-1'], {})), await fieldhouseToken())).status).toBe(200);
    await cutover(1, 'fieldhouse');
    const w = await register('vm-a', { courses: [{ repository: 'fieldhouse', course: 'roadmap-pr', version: 3 }] });
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'fieldhouse:F-1' });
    await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' });
    // The pushed target is fieldhouse (in scope) and a malformed entry follows: nothing is
    // raised for either, and the end is not refused for the malformed one.
    expect((await endClaim('vm-a', w.secret, c.claim_id, {
      end_reason: 'released:requested',
      scope_exceeded: [{ kind: 'push', target: 'immediately-run/fieldhouse', ref: 'refs/heads/claude/F-1-x' }, { kind: 'push', target: 'not a repo' }],
    })).status).toBe(200);
    expect(await rows('SELECT count(*) AS n FROM events WHERE kind IN (\'scope-exceeded\', \'unclaimed-write\')')).toEqual([{ n: 0 }]);
    expect(await findings()).toEqual([]);
  });

  it('the scope settings are owners\' settings: their shapes are checked, and a hold that stops holding is a loosening an approver admits', async () => {
    expect((await syncCall('/v1/sync/board', payload(FIELDHOUSE_SHA, null, fieldhouseBoard(['F-1'], {})), await fieldhouseToken())).status).toBe(200);
    await cutover(1, 'fieldhouse');
    for (const [body, field] of [[{ scope_policy: 'punish' }, 'scope_policy'], [{ scope_policy: 1 }, 'scope_policy'], [{ worker_pushers: 'x' }, 'worker_pushers'], [{ worker_pushers: ['a b'] }, 'worker_pushers'], [{ worker_pushers: ['x' + 'y'.repeat(100)] }, 'worker_pushers']] as const) {
      const res = await keyCall(fieldOwner, '/v1/owner/fieldhouse/settings', body, 'PUT');
      expect([JSON.stringify(body), res.status, res.json.message?.split(':')[0]]).toEqual([JSON.stringify(body), 400, field]);
    }
    // Under the cooperative preset the owner is an approvers.policy approver (R-BTN-188), so the
    // owner's own loosening — hold back to report — is admitted; holding was tightening.
    expect((await keyCall(fieldOwner, '/v1/owner/fieldhouse/settings', { scope_policy: 'hold' }, 'PUT')).status).toBe(200);
    expect((await keyCall(fieldOwner, '/v1/owner/fieldhouse/settings', { scope_policy: 'report' }, 'PUT')).status).toBe(200);
    expect((await rows<{ v: string }>('SELECT scope_policy AS v FROM repositories WHERE id = ?', 'fieldhouse'))).toEqual([{ v: 'report' }]);
    // The settings event names what changed (the values as the event carries them).
    expect(await rows<{ v: string }>(`SELECT json_extract(detail_json, '$.scope_policy') AS v FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'settings' AND json_extract(detail_json, '$.repository') = 'fieldhouse'`))
      .toEqual([{ v: 'hold' }, { v: 'report' }]);
  });
});
