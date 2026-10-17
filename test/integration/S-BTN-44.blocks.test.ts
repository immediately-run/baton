// S-BTN-44 blocks, resources and decisions (BATON_SPEC §13a, §2g R-BTN-75–78, §2l R-BTN-101;
// R3-1251), on both hosts. In `docs`: A's posted `blocked_by` is B; C requires `real-iphone`, which
// no live worker declares; D's `review` leg needs `llm:deepseek-v4-flash`, served by the account
// instances `opencode-go:go_plus` and `opencode-go:go_plus_2`; W1 uses `go_plus`, W2 both; E posts
// an open decision; the owner sets an unblocked trigger; W3 sits idle. Must hold: each block named
// from the stored rows, the fleet's and a worker's own answers, the lapse to `unknown`, the refusals
// and the override, `unblocked` logged with what cleared, W3's message and fresh recommendation, one
// coalesced dispatch, liveness, and Needs you after a day.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, cutover, keyCall, placed, recommended, rows, setAdminKeys, setClock, tick, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { grantedWorker, signed, SCHEMA, type FleetWorker } from '../lib/fleet';
import type { Workflow } from '../../src/core/ports';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const R = 'llm:deepseek-v4-flash';
const GO = 'opencode-go:go_plus';
const GO2 = 'opencode-go:go_plus_2';
const CAPS = ['agent-venue'];

let admin: TestKey;
let owner: TestKey;
let probe: TestKey;
let git: Git;
let sent: Workflow[];

const blocksOf = async (local: string, as: { key: TestKey; secret?: string } = { key: owner }, me = false) =>
  (await signed(as.key, `/v1/repositories/docs/tickets/${local}/blocks${me ? '?worker=me' : ''}`, { secret: as.secret })).json;
const blockedOn = async (on: string) => (await signed(owner, `/v1/repositories/docs/blocked?on=${encodeURIComponent(on)}`)).json;
const events = async (kind: string) => (await rows<{ ticket_id: string; detail_json: string }>('SELECT ticket_id, detail_json FROM events WHERE kind = ? ORDER BY seq', kind))
  .map((e) => ({ ticket: e.ticket_id, ...JSON.parse(e.detail_json) }));
/** Move the clock to `to` the way time passes for live workers: they heartbeat every few minutes
 *  (§6.3), so none lapses on the way; each step's alarm runs. */
async function advance(from: number, to: number, alive: FleetWorker[]) {
  for (let t = Math.min(from + 5 * MIN, to); ; t = Math.min(t + 5 * MIN, to)) {
    await setClock(t);
    for (const w of alive) await w.beat();
    await tick();
    if (t === to) return;
  }
}
const needsReview = (needs: string[]) => ({ ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs }] });

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  probe = await makeKey('ssh-ed25519', 'probe');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA })).status).toBe(200);
  for (const name of [GO, GO2]) expect((await keyCall(admin, '/v1/admin/instances', { name, serves: [R], repositories: ['docs'] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/probes', { public_key: probe.publicKey, label: 'quota probe' })).status).toBe(200);
  expect((await keyCall(owner, '/v1/owner/docs/settings', { unblocked_trigger: { kind: 'github-app', workflow: '.github/workflows/baton-unblocked.yml' } }, 'PUT')).status).toBe(200);
  git = new Git()
    .add('B')
    .add('A', { blocked_by: ['B'] })
    .add('C', { requires: ['real-iphone'] })
    .add('D', {}, needsReview([R]))
    .add('E', {}, placed('filed', [], [['implement', 'ready']], { decisions: [{ id: 'R3-E-1', asks: 'owner', url: 'https://github.com/immediately-run/docs/pull/7' }] }));
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
  sent = [];
  await withCore((c) => {
    c.dispatcher = async (wf) => {
      sent.push(wf);
      return true;
    };
  });
});

describe('S-BTN-44 blocks, resources and decisions', () => {
  it('names every source of a block, answers per worker, refuses and overrides, unblocks with what cleared', async () => {
    const w1 = await grantedWorker(owner, 'docs', 'w1', CAPS, [GO]);
    const w2 = await grantedWorker(owner, 'docs', 'w2', CAPS, [GO, GO2]);
    const w3 = await grantedWorker(owner, 'docs', 'w3', CAPS);
    const w4 = await grantedWorker(owner, 'docs', 'w4', CAPS);

    // The rows, as the owner reads them.
    expect(await blocksOf('A')).toMatchObject({ blocked: true, blocks: [{ kind: 'ticket', ref: 'docs:B' }] });
    expect(await blocksOf('C')).toMatchObject({ blocked: true, blocks: [{ kind: 'capability', ref: 'real-iphone' }] });
    expect(await blocksOf('E')).toMatchObject({ blocked: true, blocks: [{ kind: 'decision', ref: 'R3-E-1' }] });
    // Both instances unknown: advice fails open, D is not blocked.
    expect(await blocksOf('D')).toMatchObject({ blocked: false, blocks: [] });

    // W1's leg meets a rate limit: go_plus unavailable until +1 h.
    expect((await w1.call('/v1/runner/readings', { readings: [{ instance: GO, available: false, until: T0 + H }] })).json).toMatchObject({ ok: true, refused: [] });
    // Only W1's own instances are all down: blocked for W1, not for W2, not for the fleet.
    expect(await blocksOf('D', w1, true)).toMatchObject({ blocked: true, blocks: [{ kind: 'resource', leg: 'review', ref: R, until: T0 + H }] });
    expect(await blocksOf('D', w2, true)).toMatchObject({ blocked: false, blocks: [] });
    expect((await blocksOf('D')).blocked).toBe(false);
    // …so D is recommended to W2 and not to W1.
    expect(await recommended(w2.id)).toContain('docs:D');
    expect(await recommended(w1.id)).not.toContain('docs:D');

    // A probe posts go_plus_2 unavailable with no `until`, for 10 minutes: blocked for the fleet.
    expect((await signed(probe, '/v1/probe/readings', { body: { readings: [{ instance: GO2, available: false, valid_for: 600 }] } })).json).toMatchObject({ ok: true, refused: [] });
    expect(await blocksOf('D')).toMatchObject({ blocked: true, blocks: [{ kind: 'resource', leg: 'review', ref: R }] });
    expect((await blockedOn(`resource:${R}`)).tickets.map((t: { ticket_id: string }) => t.ticket_id)).toEqual(['docs:D']);
    expect((await blockedOn('decision:*')).tickets.map((t: { ticket_id: string }) => t.ticket_id)).toEqual(['docs:E']);
    expect((await blockedOn('ticket:docs:B')).tickets).toMatchObject([{ ticket_id: 'docs:A', blocked: true }]);

    // A worker reporting on an instance it does not use, which lists its repository: accepted (R-BTN-101).
    expect((await w3.call('/v1/runner/readings', { readings: [{ instance: GO2, kind: 'measure', detail: { used: 4 } }] })).json).toMatchObject({ ok: true, refused: [] });

    // A and E are refused `blocked`; no claim of D without its id (advice) — W4 asks for any.
    expect((await w4.call('/v1/runner/claim', { request_id: 'req-claim-a', ticket_id: 'docs:A' })).json).toMatchObject({ code: 'blocked', rule: 1, rule_code: 'blocked' });
    expect((await w4.call('/v1/runner/claim', { request_id: 'req-claim-e', ticket_id: 'docs:E' })).json).toMatchObject({ code: 'blocked' });
    expect(await recommended(w4.id)).not.toContain('docs:D');

    // The probe's reading lapses: go_plus_2 is unknown, which unblocks D for the fleet.
    await advance(T0, T0 + 10 * MIN, [w1, w2, w3, w4]);
    expect(await blocksOf('D')).toMatchObject({ blocked: false, blocks: [] });
    expect(await events('resource')).toEqual(expect.arrayContaining([expect.objectContaining({ instance: GO2, state: 'unknown', was: 'unavailable' })]));
    expect((await events('unblocked')).filter((e) => e.ticket === 'docs:D')).toEqual([{ ticket: 'docs:D', cleared: [{ kind: 'resource', ref: R, leg: 'review' }] }]);
    // The first unblocking of the window dispatches at once.
    expect(sent.filter((s) => s.kind === 'unblocked')).toEqual([{ repository: 'docs', kind: 'unblocked', tickets: [{ ticket: 'docs:D', cleared: [{ kind: 'resource', ref: R, leg: 'review' }] }] }]);

    // B archived and E's packet answered in git, in one push: A and E unblock in one window.
    git.close('B', 'done');
    git.tickets.get('A')!.blocked_by = [];
    git.place('E', placed('filed', [], [['implement', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect((await events('unblocked')).map((e) => e.ticket)).toEqual(['docs:D', 'docs:A', 'docs:E']);
    expect((await events('unblocked')).find((e) => e.ticket === 'docs:E')).toMatchObject({ cleared: [{ kind: 'decision', ref: 'R3-E-1' }] });
    // Within D's dispatch window: held for the trailing dispatch, which carries both.
    expect(sent.filter((s) => s.kind === 'unblocked')).toHaveLength(1);
    await setClock(T0 + 10 * MIN + 30_000);
    await tick();
    const dispatches = sent.filter((s) => s.kind === 'unblocked');
    expect(dispatches).toHaveLength(2);
    expect((dispatches[1].tickets as { ticket: string }[]).map((t) => t.ticket)).toEqual(['docs:A', 'docs:E']);

    // W3, idle, is sent `unblocked` messages naming what it may now take — one pending at a time,
    // updated in place (a host whose alarm fires on its own may deliver D's a beat earlier) — and
    // its recommendation is fresh.
    const hb = await w3.beat();
    expect((hb.json.messages as { kind: string }[]).filter((m) => m.kind === 'unblocked').length).toBeGreaterThan(0);
    const toW3 = await rows<{ payload_json: string; status: string }>(`SELECT payload_json, status FROM messages WHERE to_worker_id = ? AND kind = 'unblocked' ORDER BY id`, w3.id);
    expect(toW3.filter((m) => m.status === 'pending')).toEqual([]);
    expect(toW3.flatMap((m) => (JSON.parse(m.payload_json) as { tickets: { ticket_id: string }[] }).tickets.map((t) => t.ticket_id))).toEqual(['docs:D', 'docs:A', 'docs:E']);
    expect(await recommended(w3.id)).toEqual(expect.arrayContaining(['docs:A', 'docs:D', 'docs:E']));

    // A worker declaring real-iphone registers: C unblocks; it stops heartbeating: C is blocked again.
    const phone = await grantedWorker(owner, 'docs', 'phone', [...CAPS, 'real-iphone']);
    expect(await blocksOf('C')).toMatchObject({ blocked: false, blocks: [] });
    expect((await events('unblocked')).at(-1)).toMatchObject({ ticket: 'docs:C', cleared: [{ kind: 'capability', ref: 'real-iphone' }] });
    await advance(T0 + 10 * MIN + 30_000, T0 + 10 * MIN + 30_000 + 20 * MIN, [w1, w2, w3, w4]);
    expect(await blocksOf('C')).toMatchObject({ blocked: true, blocks: [{ kind: 'capability', ref: 'real-iphone' }] });
    expect(phone.id).toBeGreaterThan(0);

    // D blocked again for the fleet (both accounts down); W4 claims it by id: accepted, advice overridden.
    expect((await signed(probe, '/v1/probe/readings', { body: { readings: [{ instance: GO2, available: false, valid_for: 3600 }] } })).status).toBe(200);
    expect((await blocksOf('D')).blocked).toBe(true);
    const claim = await w4.call('/v1/runner/claim', { request_id: 'req-claim-d', ticket_id: 'docs:D' });
    expect(claim.json).toMatchObject({ ticket_id: 'docs:D' });
    const overridden = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'advice-overridden' AND ticket_id = 'docs:D'`);
    expect(JSON.parse(overridden[0].detail_json).overridden).toEqual(expect.arrayContaining([{ advice: 'resource', leg: 'review', resources: [R] }]));
    // A claimed ticket is not waiting: blocked_since clears silently, no `unblocked`.
    expect((await blocksOf('D')).blocked).toBe(false);
    expect((await events('unblocked')).filter((e) => e.ticket === 'docs:D')).toHaveLength(1);

    // The clock passes +1 h: W1's go_plus reading lapses at its `until`.
    await advance(T0 + 30 * MIN + 30_000, T0 + H + MIN, [w1, w2, w3, w4]);
    expect(await rows('SELECT state FROM instance_states WHERE instance = ?', GO)).toEqual([{ state: 'unknown' }]);

    // After a day blocked on a capability no live worker has, C is under Needs you.
    await setClock(T0 + 26 * H);
    await tick();
    const state = await withCore((c) => c.uiState());
    expect(state.needs_you.blocked_capability).toEqual([expect.objectContaining({ ticket_id: 'docs:C', capability: 'real-iphone' })]);
  });

  it('an instance no instrument reports on for a day while a posted leg needs it is under Needs you', async () => {
    await setClock(T0 + 25 * H);
    await tick();
    const state = await withCore((c) => c.uiState());
    expect((state.needs_you.instances_unknown as { instance: string }[]).map((i) => i.instance)).toEqual([GO, GO2]);
  });

  it('a decision’s url outside the ticket’s repositories is dropped, the decision kept; a reserved id is dropped', async () => {
    git.place('E', placed('filed', [], [['implement', 'ready']], { decisions: [
      { id: 'R3-E-2', asks: 'owner', url: 'https://evil.example/x' },
      { id: 'baton:retries', asks: 'owner' },
    ] }));
    const res = (await git.post()) as Record<string, unknown>;
    expect(res.dropped).toEqual(['docs:E:decision:baton:retries']);
    expect(await rows('SELECT decision_id, leg, url, source FROM ticket_decisions WHERE ticket_id = ?', 'docs:E')).toEqual([{ decision_id: 'R3-E-2', leg: '', url: null, source: 'sync' }]);
  });
});
