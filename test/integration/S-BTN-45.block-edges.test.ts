// S-BTN-45 the edges of blocks (BATON_SPEC §13a, §2g R-BTN-75–78, §2l R-BTN-101; R3-1251), on both
// hosts — every case but the leg queues', which are R3-1255's. In `docs`: `opencode-go:go_plus`
// serves `llm:deepseek-v4-flash` and `llm:glm-5`, for `docs` only. Must hold: a `$ref` schema is
// refused at registration; another repository's worker is refused `forbidden` for go_plus; one
// reading blocks both resources' legs; a reading whose detail fails the schema is `invalid-params`;
// an unavailable reading lapses at its `until`; an administrator's reading wins and an instrument's
// takes over after it (`overridden` meanwhile); overnight the rows clear silently, none is written,
// `other` lists `no-instance`, and the morning's answer logs the `unblocked` the evening was owed;
// G's leg decision refuses the advance into it, not the claim; H's decision naming a leg it lacks
// sits on the whole ticket and its `url` is dropped. The 150 unblockings that dispatch 100 entries
// and `{truncated: 50}` are in test/unit/blocks.test.ts: the formal model cannot replay an instance
// of 152 tickets (scripts/check-traces.mjs), and the cap is the core's alone.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, cutover, keyCall, placed, rows, setAdminKeys, setClock, syncCall, syncToken, tick } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { grantedWorker, signed, SCHEMA } from '../lib/fleet';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const DS = 'llm:deepseek-v4-flash';
const GLM = 'llm:glm-5';
const GO = 'opencode-go:go_plus';
const CAPS = ['agent-venue'];

let admin: TestKey;
let owner: TestKey;
let opsOwner: TestKey;
let probe: TestKey;
let git: Git;

const blocksOf = async (local: string) => (await signed(owner, `/v1/repositories/docs/tickets/${local}/blocks`)).json;
const reviewNeeds = (needs: string[]) => ({ ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs }] });
const stateOf = async (instance: string) => (await rows<{ state: string }>('SELECT state FROM instance_states WHERE instance = ?', instance))[0]?.state;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  probe = await makeKey('ssh-ed25519', 'probe');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [opsOwner.publicKey] })).status).toBe(200);
  for (const name of [DS, GLM]) expect((await keyCall(admin, '/v1/admin/resources', { name, scope: 'account', detail_schema: SCHEMA })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [DS, GLM], repositories: ['docs'] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/probes', { public_key: probe.publicKey, label: 'quota probe' })).status).toBe(200);
  git = new Git().add('D', {}, reviewNeeds([DS])).add('F', {}, reviewNeeds([GLM]));
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
});

describe('S-BTN-45 the edges of blocks', () => {
  it('refuses a schema outside the subset, and an instance serving resources of two schemas', async () => {
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'disk:fileserver-1', scope: 'service', detail_schema: { $ref: '#/x' } })).json).toMatchObject({ code: 'invalid-params' });
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'llm:other', scope: 'account', detail_schema: { type: 'object' } })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/instances', { name: 'acct:two', serves: [DS, 'llm:other'], repositories: ['docs'] })).json).toMatchObject({ code: 'invalid-params' });
    // A resource registered again with another scope is a conflict; the same one is idempotent.
    expect((await keyCall(admin, '/v1/admin/resources', { name: DS, scope: 'service', detail_schema: SCHEMA })).json).toMatchObject({ code: 'conflict' });
    expect((await keyCall(admin, '/v1/admin/resources', { name: DS, scope: 'account', detail_schema: SCHEMA })).status).toBe(200);
  });

  it('isolates repositories, blocks two resources with one reading, refuses bad detail, lapses at until, and orders the readings', async () => {
    // A worker granted only on ops declares go_plus, which lists docs alone: refused, the heartbeat
    // succeeds; its reading for go_plus is forbidden.
    const opsWorker = await grantedWorker(opsOwner, 'ops', 'opsw', CAPS, [GO]);
    const hb = await opsWorker.beat();
    expect(hb.status).toBe(200);
    expect(hb.json.refused_uses).toEqual([{ instance: GO, code: 'forbidden' }]);
    expect((await opsWorker.call('/v1/runner/readings', { readings: [{ instance: GO, available: false }] })).json.refused).toEqual([{ instance: GO, code: 'forbidden' }]);

    // A malformed name is refused on its own entry; the heartbeat and the good name stand.
    const mixed = await opsWorker.beat({ uses: ['Not A Name'] });
    expect(mixed.status).toBe(200);
    expect(mixed.json.refused_uses).toEqual([{ instance: 'Not A Name', code: 'invalid-params' }]);

    // W1 uses go_plus: one reading — unavailable until +20 min, valid_for 24 h — blocks F and D together.
    const w1 = await grantedWorker(owner, 'docs', 'w1', CAPS, [GO]);
    const posted = await w1.call('/v1/runner/readings', { readings: [
      { instance: GO, available: false, until: T0 + 20 * MIN, valid_for: 24 * 3600 },
      { instance: GO, kind: 'measure', detail: { used: -1 } },
    ] });
    expect(posted.json.refused).toEqual([{ instance: GO, code: 'invalid-params', message: expect.stringMatching(/at least 0/) }]);
    expect(await blocksOf('D')).toMatchObject({ blocked: true, blocks: [{ kind: 'resource', ref: DS, leg: 'review', until: T0 + 20 * MIN }] });
    expect(await blocksOf('F')).toMatchObject({ blocked: true, blocks: [{ kind: 'resource', ref: GLM, leg: 'review' }] });
    // The second reading a minute is refused for the same worker and instance.
    expect((await w1.call('/v1/runner/readings', { readings: [{ instance: GO, available: true }] })).json.refused).toEqual([{ instance: GO, code: 'rate-limited' }]);

    // At +20 min the reading lapses at its `until`, not after 24 h.
    await setClock(T0 + 20 * MIN);
    await w1.beat();
    await tick();
    expect(await stateOf(GO)).toBe('unknown');
    expect((await blocksOf('D')).blocked).toBe(false);

    // An administrator sets go_plus available for 1 h; a probe posts it unavailable within that hour:
    // stored, answered `overridden`, and the state when the administrator's lapses.
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: true, valid_for: 3600 }] })).json).toMatchObject({ ok: true, refused: [] });
    expect(await stateOf(GO)).toBe('available');
    await setClock(T0 + 30 * MIN);
    await w1.beat();
    expect((await signed(probe, '/v1/probe/readings', { body: { readings: [{ instance: GO, available: false, valid_for: 2 * 3600 }] } })).json).toMatchObject({ ok: true, overridden: [GO] });
    expect(await stateOf(GO)).toBe('available');
    for (const t of [T0 + 40 * MIN, T0 + 50 * MIN, T0 + 60 * MIN, T0 + 80 * MIN]) {
      await setClock(t);
      await w1.beat();
      await tick();
    }
    expect(await stateOf(GO)).toBe('unavailable');
    expect((await blocksOf('F')).blocked).toBe(true);

    // Overnight every worker stops: no live worker has a usable instance, so no row, and `no-instance`.
    // The lost answer clears F's row silently: nothing became claimable, so no `unblocked` (R-BTN-77).
    const unblockedF = async () => (await rows(`SELECT seq FROM events WHERE kind = 'unblocked' AND ticket_id = 'docs:F'`)).length;
    const eveningF = await unblockedF();
    await setClock(T0 + 12 * H);
    await tick();
    expect((await blocksOf('F')).blocked).toBe(false);
    expect(await unblockedF()).toBe(eveningF);
    const night = await blocksOf('D');
    expect(night).toMatchObject({ blocked: false, blocks: [] });
    expect(night.other).toEqual(expect.arrayContaining([{ kind: 'no-instance', detail: { leg: 'review', resource: DS } }]));
    // The first heartbeat in the morning: the probe's reading lapsed overnight, so go_plus is back
    // to unknown while nobody could see it. The fleet answers again, and D and F get the `unblocked`
    // their evening `blocked` was owed (R-BTN-77 as amended) — no block written and cleared.
    const seq = (await rows<{ s: number }>('SELECT max(seq) AS s FROM events'))[0].s;
    await w1.beat();
    expect(await rows(`SELECT kind, ticket_id, json_extract(detail_json, '$.cleared') AS cleared FROM events WHERE seq > ? AND kind IN ('blocked', 'unblocked') ORDER BY ticket_id`, seq)).toEqual([
      { kind: 'unblocked', ticket_id: 'docs:D', cleared: JSON.stringify([{ kind: 'resource', ref: DS, leg: 'review' }]) },
      { kind: 'unblocked', ticket_id: 'docs:F', cleared: JSON.stringify([{ kind: 'resource', ref: GLM, leg: 'review' }]) },
    ]);
    expect(await rows('SELECT answer_lost FROM tickets WHERE answer_lost IS NOT NULL')).toEqual([]);
    expect((await blocksOf('D')).blocked).toBe(false);
  });

  it('a leg decision refuses the advance into the leg, not the claim; a bad leg puts it on the whole ticket and a bad url is dropped', async () => {
    git.add('G', {}, placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready'], ['merge', 'waiting', 'ci']], {
      decisions: [{ id: 'G-merge', leg: 'merge', asks: 'owner' }] }));
    git.add('H', {}, placed('filed', [], [['implement', 'ready']], { decisions: [{ id: 'H-1', leg: 'adjudicate', asks: 'owner', url: 'javascript:alert(1)' }] }));
    expect((await git.post()).status).toBe(200);
    // G's queued leg, fix, is free: G is not blocked.
    expect(await blocksOf('G')).toMatchObject({ blocked: false, blocks: [{ kind: 'decision', ref: 'G-merge', leg: 'merge' }] });
    expect(await blocksOf('H')).toMatchObject({ blocked: true, blocks: [{ kind: 'decision', ref: 'H-1' }] });
    expect((await blocksOf('H')).blocks[0].leg).toBeUndefined();
    expect(await rows('SELECT url FROM ticket_decisions WHERE ticket_id = ?', 'docs:H')).toEqual([{ url: null }]);

    const w = await grantedWorker(owner, 'docs', 'wg', CAPS);
    const claim = await w.call('/v1/runner/claim', { request_id: 'req-claim-g', ticket_id: 'docs:G' });
    expect(claim.json).toMatchObject({ ticket_id: 'docs:G', legs: ['fix'] });
    const id = claim.json.claim_id as number;
    expect((await w.call(`/v1/runner/claims/${id}/advance`, { leg: 'fix' })).status).toBe(200);
    expect((await w.call(`/v1/runner/claims/${id}/advance`, { leg: 'review', reached: 'fixed' })).status).toBe(200);
    expect((await w.call(`/v1/runner/claims/${id}/advance`, { leg: 'merge', reached: 'reviewed' })).json).toMatchObject({ code: 'blocked', rule: 1, rule_code: 'blocked' });
  });

  it('another repository’s sync cannot write docs’ blocks, and a key granted on no listed repository asks nothing', async () => {
    const ops = await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' });
    expect((await syncCall('/v1/sync/board', new Git(ops).add('X', { blocked_by: ['D'] }).body('a'.repeat(40), null), ops)).status).toBe(200);
    expect(await rows(`SELECT ticket_id, ref FROM ticket_blocks WHERE kind = 'ticket'`)).toEqual([{ ticket_id: 'ops:X', ref: 'ops:D' }]);
    const opsWorker = await grantedWorker(opsOwner, 'ops', 'opsq', CAPS);
    expect((await opsWorker.call('/v1/repositories/docs/tickets/D/blocks', undefined, 'GET')).json).toMatchObject({ code: 'forbidden' });
    expect((await opsWorker.call('/v1/repositories/ops/tickets/X/blocks', undefined, 'GET')).json).toMatchObject({ blocked: true });
  });
});
