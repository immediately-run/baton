// S-BTN-202 owner-signed briefs and the signed-control record (B-127, BATON_SPEC §7.1,
// R-BTN-66 as amended): what a repository's sync posts about owner signatures, as Baton holds
// and serves it. Must hold: a ticket's brief mark — `{signed, signer?, commit}`, posted whether
// or not signed control is required — is stored with the ticket and re-posted clean; a signed
// brief names its key, an unsigned one names none; the post's `control` record stands for the
// repository and its `unsigned` list raises one `unsigned-control` event under Needs you, only
// while the repository requires signed control and only when the head moved; the observation
// serves the owner signing keys and the setting; and the settings PUT turns the requirement on
// for any owner, while turning it off is a loosening an `approvers.policy` approver signs for.
// Both hosts: the client half (the walks that compute the marks and the record over real git,
// and each runner's own verification of the named commits) is test/unit/signed-control.test.ts
// and S-BTN-203.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, adminSession, course, keyCall, observe, payload, rows, sessionCall, setAdminKeys, setClock, syncCall, ticket, placed, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-06T12:00:00Z');
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const FP = 'SHA256:' + 'k'.repeat(43);
const FP2 = 'SHA256:' + 'j'.repeat(43);

let admin: TestKey;
let owner: TestKey;
/** The owner key's public line as Baton stores it (type and base64, no comment). */
let ownerLine: string;

/** The `control` record as the sync posts it (B-127): four groups, each with its read commit. */
const control = (over: Record<string, unknown> = {}) => ({
  keys: [FP],
  groups: {
    agent_command: { read: SHA, key: FP, unsigned: [OTHER_SHA] },
    overrides: { read: SHA, key: FP, unsigned: [] },
    rank: { read: null, key: null, unsigned: [] },
    course: { read: SHA, key: FP, unsigned: [] },
  },
  unsigned: [{ path: '.baton/baton.json', commits: [OTHER_SHA] }],
  ...over,
});

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  // B-136's register as far as it is built: the owner key marked in the tenant's human-only
  // register is what B-127's signing keys are.
  ownerLine = owner.publicKey.split(' ').slice(0, 2).join(' ');
  await rows('INSERT INTO human_keys (fingerprint, public_key, added_by, added_at) VALUES (?, ?, ?, ?)', owner.fingerprint, owner.publicKey, 'admin:test', T0);
});

describe(`S-BTN-202 owner-signed briefs and the signed-control record`, () => {
  it('a ticket\'s brief mark is stored with the ticket, and a re-post replaces it', async () => {
    const git = new Git();
    git.add('T-1', { brief: { signed: true, signer: FP, commit: SHA } });
    expect((await git.post()).status).toBe(200);
    expect(await rows('SELECT brief FROM tickets WHERE id = ?', 'docs:T-1')).toEqual([
      { brief: JSON.stringify({ signed: true, signer: FP, commit: SHA }) },
    ]);
    git.add('T-1', { brief: { signed: false, commit: OTHER_SHA } });
    expect((await git.post()).status).toBe(200);
    expect(await rows('SELECT brief FROM tickets WHERE id = ?', 'docs:T-1')).toEqual([
      { brief: JSON.stringify({ signed: false, commit: OTHER_SHA }) },
    ]);
  });

  it('a signed brief names its signing key; an unsigned one names none', async () => {
    const normative = (over: Record<string, unknown>) => syncCall('/v1/sync/board', {
      registry: [course()], sha: 'c'.repeat(40), parent_sha: null, closed: [], stations: {}, ...over,
    });
    const res = await normative({ tickets: [ticket('T-1', { brief: { signed: true, commit: SHA } })] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain('a signed brief names its signing key');
    const res2 = await normative({ tickets: [ticket('T-1', { brief: { signed: false, signer: FP, commit: SHA } })] });
    expect(res2.status).toBe(400);
    expect(((await res2.json()) as { message: string }).message).toContain('an unsigned brief names no signing key');
  });

  it('the control record stands for the repository, checked: keys, groups and the unsigned list', async () => {
    const git = new Git();
    git.add('T-1');
    expect((await git.post({ control: control() })).status).toBe(200);
    expect(await rows('SELECT sha, control_json FROM signed_control WHERE repository_id = ?', 'docs')).toEqual([
      { sha: git.head, control_json: JSON.stringify(control()) },
    ]);
    // A refused post does not consume its observation number (R-BTN-62), so each post here
    // takes a fresh one: the clock ticks past the 10-minute TTL between posts, and every 400
    // below is the control shape's own refusal, not a stale number's.
    let at = T0;
    const tick = () => setClock(at += 11 * 60_000);
    for (const bad of [
      { ...control(), keys: [FP, FP] },
      control({ keys: ['not-a-fingerprint'] }),
      control({ groups: { ...control().groups, agent_command: { read: 'nope', key: FP, unsigned: [] } } }),
      control({ groups: { ...control().groups, agent_command: { read: SHA, key: FP2, unsigned: [] } } }),
      control({ unsigned: [{ path: '.baton/baton.json', commits: [] }] }),
      // Round 1 (the course group): an unknown group name is refused.
      control({ groups: { ...control().groups, sync: { read: SHA, key: FP, unsigned: [] } } }),
      control({ groups: { ...control().groups, agent_command: { read: SHA, key: FP, unsigned: [], nope: 1 } } }),
    ]) {
      await tick();
      const res = await syncCall('/v1/sync/board', payload('d'.repeat(40), git.head, { items: [], ready: [] }, { control: bad }));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(((await res.json()) as { message: string }).message, JSON.stringify(bad)).toContain('control');
    }
    for (const good of [
      // The pre-course-group shape (a sync from before the group) still stands.
      control({ groups: { agent_command: control().groups.agent_command, overrides: control().groups.overrides, rank: control().groups.rank } }),
    ]) {
      await tick();
      const res = await syncCall('/v1/sync/board', payload('e'.repeat(40), git.head, { items: [], ready: [] }, { control: good }));
      expect(res.status, JSON.stringify(good)).toBe(200);
    }
  });

  it('unsigned control raises one event under Needs you while — and only while — it is required', async () => {
    const git = new Git();
    git.add('T-1');
    // Off (the default): the record stands, nothing is raised.
    expect((await git.post({ control: control() })).status).toBe(200);
    expect(await rows(`SELECT COUNT(*) AS n FROM events WHERE kind = 'unsigned-control'`)).toEqual([{ n: 0 }]);
    // On: a post that moves the head onto the unsigned change raises once; a refresh of the same
    // head raises nothing new.
    expect((await keyCall(owner, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await git.post({ control: control() })).status).toBe(200);
    expect((await git.refresh({ control: control() })).status).toBe(200);
    const events = await rows<{ repository_id: string; detail_json: string }>(`SELECT repository_id, detail_json FROM events WHERE kind = 'unsigned-control'`);
    expect(events.length).toBe(1);
    const detail = JSON.parse(events[0].detail_json) as { changes: { path: string; commits: string[] }[] };
    expect(detail.changes).toEqual([{ path: '.baton/baton.json', commits: [OTHER_SHA] }]);
    // §14 Needs you lists it — the state answer's own surface (round 1: the notice used to be
    // raised into a view nothing rendered; asserting the events table proved nothing).
    // §14 Needs you lists it — the state answer's own surface, read as the dashboard does
    // (round 1: the notice used to be raised into a view nothing rendered; asserting the
    // events table proved nothing about the view).
    const session = await adminSession(admin);
    const uiRes = await sessionCall(session, '/v1/ui/state');
    expect(uiRes.status).toBe(200);
    const state = (await uiRes.json()) as { needs_you: { unsigned_control: { repository_id: string; changes: { path: string; commits: string[] }[] }[] } };
    expect(state.needs_you.unsigned_control.map((u) => [u.repository_id, u.changes])).toEqual([['docs', [{ path: '.baton/baton.json', commits: [OTHER_SHA] }]]]);
    // Round 1 (re-firing): a later head move that changes nothing about the standing unsigned
    // change raises nothing new; the same path under a NEW unsigned commit does.
    expect((await git.post({ control: control() })).status).toBe(200);
    expect(await rows(`SELECT COUNT(*) AS n FROM events WHERE kind = 'unsigned-control'`)).toEqual([{ n: 1 }]);
    const NEW_SHA = 'c'.repeat(40);
    expect((await git.post({ control: control({ unsigned: [{ path: '.baton/baton.json', commits: [NEW_SHA] }] }) })).status).toBe(200);
    const events2 = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'unsigned-control'`);
    expect(events2.length).toBe(2);
    expect((JSON.parse(events2[1].detail_json) as { changes: { commits: string[] }[] }).changes).toEqual([{ path: '.baton/baton.json', commits: [NEW_SHA] }]);
    // A post with no unsigned change raises nothing.
    expect((await git.post({ control: control({ unsigned: [] }) })).status).toBe(200);
    expect(await rows(`SELECT COUNT(*) AS n FROM events WHERE kind = 'unsigned-control'`)).toEqual([{ n: 2 }]);
  });

  it('the observation serves the owner signing keys and the setting; the read answers an owner too', async () => {
    const o = await observe();
    expect(o.json.signing_keys).toEqual([{ public_key: ownerLine, fingerprint: owner.fingerprint }]);
    expect(o.json.require_signed_control).toBe(false);
    expect((await keyCall(owner, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    await setClock(T0 + 11 * 60_000); // the outstanding number lapses (R-BTN-62)
    const o2 = await observe();
    expect(o2.json.require_signed_control).toBe(true);
    expect((await keyCall(owner, '/v1/owner/docs/signing-keys')).json).toEqual({ keys: [{ public_key: ownerLine, fingerprint: owner.fingerprint }] });
  });

  it('turning the requirement on is any owner\'s; off is a loosening, governed where a policy stands', async () => {
    expect((await keyCall(owner, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    // R-BTN-186/188: the off-toggle is a loosening, gated by `approvers.policy` as it stands —
    // docs' cooperative preset lists `owner`, so this owner may; under `protected` (S-BTN-189's
    // ground) the same PUT is the refusal every governed setting raises there.
    expect((await keyCall(owner, '/v1/owner/docs/settings', { require_signed_control: false }, 'PUT')).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    const bad = await keyCall(owner, '/v1/owner/docs/settings', { require_signed_control: 'yes' }, 'PUT');
    expect([bad.status, (bad.json as { message: string }).message.includes('must be a boolean')]).toEqual([400, true]);
    // What stands is visible in the settings read.
    const grants = (await keyCall(owner, '/v1/owner/docs/grants')).json as { settings: { require_signed_control: unknown } };
    expect(grants.settings.require_signed_control).toBe(1);
  });

  it('the registry entry the sync posts is unchanged by the record (a course list still applies)', async () => {
    const git = new Git();
    git.registry = [course()];
    git.add('T-1');
    expect((await git.post({ control: control() })).status).toBe(200);
    expect((await git.post({ control: control({ unsigned: [] }) })).status).toBe(200);
    expect(await rows('SELECT COUNT(*) AS n FROM courses WHERE repository_id = ?', 'docs')).toEqual([{ n: 1 }]);
  });
});
