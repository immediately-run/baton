// blocks.test.ts — the one writer of ticket_blocks and blocked_since (BATON_SPEC §2g R-BTN-75–78;
// R3-1251): each cause added and removed and only its diff written; held versus blocked; a
// dependency reopened; a capability count and a resource condition crossing zero both ways; a
// reading's `until` passing on the fake clock; `transitive=1` over a chain; and the query plans
// G-BTN-70's cost claim rests on.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, armedAt, cutover, keyCall, placed, register, beat, claimItem, endClaim, rows, seedClaim, setAdminKeys, setClock, tick, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { grantedWorker, signed, SCHEMA } from '../lib/fleet';
import type { Workflow } from '../../src/core/ports';
import { BLOCK_SQL, STALLED_AFTER_MS } from '../../src/core/blocks';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60_000;
const R = 'llm:deepseek-v4-flash';
const GO = 'opencode-go:go_plus';

let admin: TestKey;
let owner: TestKey;
let git: Git;

const blockRows = (local: string) => rows<{ kind: string; ref: string; leg: string; since: number }>(
  'SELECT kind, ref, leg, since FROM ticket_blocks WHERE ticket_id = ? ORDER BY kind, ref, leg', `docs:${local}`);
const since = async (local: string) => (await rows<{ b: number | null }>('SELECT blocked_since AS b FROM tickets WHERE id = ?', `docs:${local}`))[0]?.b ?? null;
const kinds = async (kind: string) => (await rows<{ ticket_id: string }>('SELECT ticket_id FROM events WHERE kind = ? ORDER BY seq', kind)).map((e) => e.ticket_id);

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] });
  git = new Git();
});

describe('R-BTN-75: each cause written with its diff', () => {
  it('a ticket block comes and goes with the posted blocked_by; an unchanged post writes nothing', async () => {
    git.add('B').add('A', { blocked_by: ['B'] });
    await git.post();
    const first = await blockRows('A');
    expect(first).toEqual([{ kind: 'ticket', ref: 'docs:B', leg: '', since: T0 }]);
    expect(await since('A')).toBe(T0);
    // A later post with the same causes leaves the row, its `since` and the event log alone.
    await setClock(T0 + MIN);
    git.add('C');
    await git.post();
    expect(await blockRows('A')).toEqual(first);
    expect(await kinds('blocked')).toEqual(['docs:A']);
    // The dependency closes: the row goes and A unblocks, naming what cleared.
    git.tickets.get('A')!.blocked_by = [];
    await git.post();
    expect(await blockRows('A')).toEqual([]);
    expect(await since('A')).toBeNull();
    expect(await kinds('unblocked')).toEqual(['docs:A']);
    // Reopened: posted again, the row returns with a new `since`.
    await setClock(T0 + 2 * MIN);
    git.tickets.get('A')!.blocked_by = ['B'];
    await git.post();
    expect(await blockRows('A')).toEqual([{ kind: 'ticket', ref: 'docs:B', leg: '', since: T0 + 2 * MIN }]);
    expect(await kinds('blocked')).toEqual(['docs:A', 'docs:A']);
  });

  it('a decision on a leg that is not queued keeps the ticket unblocked; queued, it blocks', async () => {
    git.add('G', {}, placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready'], ['merge', 'waiting']], { decisions: [{ id: 'd1', leg: 'merge', asks: 'owner' }] }));
    await git.post();
    expect(await blockRows('G')).toEqual([{ kind: 'decision', ref: 'd1', leg: 'merge', since: T0 }]);
    expect(await since('G')).toBeNull();
    // The sync now queues merge: the same row blocks.
    git.place('G', placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['merge', 'ready']], { decisions: [{ id: 'd1', leg: 'merge', asks: 'owner' }] }));
    await git.post();
    expect(await since('G')).toBe(T0);
    // An end station has no queued leg: nothing waits, so even a whole-ticket decision leaves it
    // unblocked (R-BTN-75 — blocked means a queued leg cannot be claimed); the row is still kept.
    git.place('G', placed('merged', [['implement', 'pr-open'], ['review', 'reviewed'], ['merge', 'merged']], [], { decisions: [{ id: 'd2', asks: 'owner' }] }));
    await git.post();
    expect(await blockRows('G')).toEqual([{ kind: 'decision', ref: 'd2', leg: '', since: T0 }]);
    expect(await since('G')).toBeNull();
  });
});

describe('R-BTN-75: held versus blocked', () => {
  it('a claim starting or ending changes blocked_since silently', async () => {
    git.add('B').add('A', { blocked_by: ['B'] });
    await git.post();
    await cutover(T0);
    const w = await register('vm-a');
    // Clear the dependency while A is claimed: no event, since a claimed ticket is not waiting.
    git.tickets.get('A')!.blocked_by = [];
    await git.post();
    const c = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    expect(c.status).toBe(200);
    git.tickets.get('A')!.blocked_by = ['B'];
    await git.post();
    expect(await blockRows('A')).toHaveLength(1);
    expect(await since('A')).toBeNull(); // held
    const events = await kinds('blocked');
    await endClaim('vm-a', w.secret, c.json.claim_id, { end_reason: 'released:cannot-finish:transient' });
    expect(await since('A')).not.toBeNull(); // the end: blocked again, silently
    expect(await kinds('blocked')).toEqual(events);
  });
});

describe('R-BTN-75, R-BTN-76: the counts crossing zero', () => {
  it('a capability block follows the live workers declaring it, both ways', async () => {
    git.add('C', { requires: ['mcp-chrome'] });
    await git.post();
    expect(await blockRows('C')).toEqual([{ kind: 'capability', ref: 'mcp-chrome', leg: '', since: T0 }]);
    const w = await register('vm-a', { capabilities: ['mcp-chrome'] });
    expect(await blockRows('C')).toEqual([]);
    expect(await rows('SELECT workers FROM fleet_capabilities WHERE repository_id = ? AND capability = ?', 'docs', 'mcp-chrome')).toEqual([{ workers: 1 }]);
    // A second worker moves the count, not the rows.
    await register('vm-b', { capabilities: ['mcp-chrome'] });
    expect(await rows('SELECT workers FROM fleet_capabilities WHERE capability = ?', 'mcp-chrome')).toEqual([{ workers: 2 }]);
    // Both stop declaring it: the count crosses zero and the row returns.
    await beat('vm-a', w.secret, { capabilities: ['agent-venue'] });
    expect(await blockRows('C')).toEqual([]);
    await setClock(T0 + 16 * MIN);
    await beat('vm-a', w.secret, { capabilities: ['agent-venue'] });
    await tick();
    expect(await blockRows('C')).toEqual([{ kind: 'capability', ref: 'mcp-chrome', leg: '', since: T0 + 16 * MIN }]);
  });

  it('a resource condition flips both ways, and an unavailable reading lapses at its until', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    git.add('D', {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: [R, 'Not A Name'] }] });
    expect(((await git.post()) as Record<string, unknown>).dropped).toEqual(['docs:D:needs:Not A Name']);
    expect(await rows('SELECT resource FROM leg_needs WHERE ticket_id = ?', 'docs:D')).toEqual([{ resource: R }]);
    const g = await keyCall(owner, '/v1/owner/docs/grants', { public_key: (await makeKey('ssh-ed25519', 'k')).publicKey, hostname: 'k-host', capabilities: ['agent-venue'] });
    expect(g.status).toBe(200);
    // No live worker with a usable instance: no row (unanswerable).
    expect(await rows('SELECT * FROM resource_fleet')).toEqual([{ repository_id: 'docs', resource: R, usable_workers: 0, open_workers: 0 }]);
    const w = await register('vm-a', { uses: [GO] });
    expect(await rows('SELECT usable_workers, open_workers FROM resource_fleet')).toEqual([{ usable_workers: 1, open_workers: 1 }]);
    const r = await (await import('../helpers')).workerCall('/v1/runner/readings', { cred: 'vm-a', secret: w.secret, body: { readings: [{ instance: GO, available: false, until: T0 + 5 * MIN }] } });
    expect(r.status).toBe(200);
    expect(await blockRows('D')).toEqual([{ kind: 'resource', ref: R, leg: 'review', since: T0 }]);
    expect((await rows<{ until: number }>('SELECT until FROM ticket_blocks WHERE ticket_id = ?', 'docs:D'))[0].until).toBe(T0 + 5 * MIN);
    // The worker stops using the account: no usable instance, the row goes.
    await beat('vm-a', w.secret, { uses: [] });
    expect(await blockRows('D')).toEqual([]);
    await beat('vm-a', w.secret, { uses: [GO] });
    expect(await blockRows('D')).toHaveLength(1);
    // The `until` passes on the fake clock: unknown, and unblocked.
    await setClock(T0 + 5 * MIN);
    await beat('vm-a', w.secret, { uses: [GO] });
    await tick();
    expect(await blockRows('D')).toEqual([]);
    expect(await rows('SELECT state FROM instance_states WHERE instance = ?', GO)).toEqual([{ state: 'unknown' }]);
  });
});

describe('R-BTN-76, R-BTN-77: a worker\'s own instance, and an answer lost', () => {
  it('a worker-scope reading blocks; its lapse unblocks and deletes the state row; a worker that does not exist is not-found', async () => {
    const W = 'github-api';
    await keyCall(admin, '/v1/admin/resources', { name: W, scope: 'worker', detail_schema: SCHEMA });
    const probe = await makeKey('ssh-ed25519', 'probe');
    expect((await keyCall(admin, '/v1/admin/probes', { public_key: probe.publicKey, label: 'p' })).status).toBe(200);
    git.add('D', {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: [W] }] });
    await git.post();
    await cutover(T0);
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue']);
    const inst = `${W}@worker:${w.id}`;
    expect((await w.call('/v1/runner/readings', { readings: [{ instance: inst, available: false, valid_for: 600 }] })).json).toMatchObject({ ok: true, refused: [] });
    expect(await rows('SELECT instance, state FROM instance_states')).toEqual([{ instance: inst, state: 'unavailable' }]);
    expect(await blockRows('D')).toEqual([{ kind: 'resource', ref: W, leg: 'review', since: T0 }]);
    expect(await since('D')).toBe(T0);
    await setClock(T0 + 11 * MIN);
    await w.beat();
    await tick();
    // Lapsed: unknown with no reading, so the worker instance's row goes, and D is unblocked.
    expect(await rows('SELECT * FROM instance_states')).toEqual([]);
    expect(await rows(`SELECT detail_json AS d FROM events WHERE kind = 'resource' ORDER BY seq`)).toEqual([
      { d: JSON.stringify({ instance: inst, state: 'unavailable' }) },
      { d: JSON.stringify({ instance: inst, state: 'unknown', was: 'unavailable' }) },
    ]);
    expect(await blockRows('D')).toEqual([]);
    expect(await kinds('unblocked')).toEqual(['docs:D']);
    const ghost = await signed(probe, '/v1/probe/readings', { body: { readings: [{ instance: `${W}@worker:999`, available: false }] } });
    expect(ghost.json.refused).toEqual([{ instance: `${W}@worker:999`, code: 'not-found' }]);
    expect(await rows('SELECT * FROM instance_states')).toEqual([]);
  });

  it('an answer lost overnight and given back blocked re-blocks silently: the evening\'s `blocked` stands', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    git.add('D', {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: [R] }] });
    await git.post();
    await cutover(T0);
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue'], [GO]);
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }] });
    expect(await since('D')).toBe(T0);
    expect(await kinds('blocked')).toEqual(['docs:D']);
    // The worker's lease lapses: no one can answer, so the row goes silently and the loss is kept.
    await setClock(T0 + 16 * MIN);
    await tick();
    expect(await blockRows('D')).toEqual([]);
    expect(await since('D')).toBeNull();
    expect(await rows('SELECT answer_lost FROM tickets WHERE id = ?', 'docs:D')).toEqual([{ answer_lost: JSON.stringify({ since: T0, rows: [{ kind: 'resource', ref: R, leg: 'review' }] }) }]);
    expect(await kinds('unblocked')).toEqual([]);
    // It comes back: the resource is still down, so D is blocked again with no second `blocked`,
    // and blocked since the evening, as that `blocked` says.
    await w.beat();
    expect(await blockRows('D')).toEqual([{ kind: 'resource', ref: R, leg: 'review', since: T0 + 16 * MIN }]);
    expect(await since('D')).toBe(T0);
    expect(await kinds('blocked')).toEqual(['docs:D']);
    expect(await kinds('unblocked')).toEqual([]);
    expect(await rows('SELECT answer_lost FROM tickets WHERE id = ?', 'docs:D')).toEqual([{ answer_lost: null }]);
  });

  it('a fleet returning to a ticket blocked on a capability and a resource logs nothing: one evaluation per recount (B-49)', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    git.add('D', { requires: ['mcp-chrome'] }, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: [R] }] });
    await git.post();
    await cutover(T0);
    const w = await grantedWorker(owner, 'docs', 'w1', ['mcp-chrome'], [GO]);
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }] });
    expect(await blockRows('D')).toEqual([{ kind: 'resource', ref: R, leg: 'review', since: T0 }]);
    const [blocked, unblocked] = [await kinds('blocked'), await kinds('unblocked')];
    // Overnight the only worker declaring the capability lapses: its row comes, the resource's goes
    // with no one left to answer, and D stays blocked.
    await setClock(T0 + 16 * MIN);
    await tick();
    expect(await blockRows('D')).toEqual([{ kind: 'capability', ref: 'mcp-chrome', leg: '', since: T0 + 16 * MIN }]);
    expect(await since('D')).toBe(T0);
    // In the morning it heartbeats: the capability row goes and the resource's comes back in one
    // recount. D was never claimable, so no `unblocked`, no second `blocked`, and the same
    // blocked_since; no worker is messaged.
    await w.beat();
    expect(await blockRows('D')).toEqual([{ kind: 'resource', ref: R, leg: 'review', since: T0 + 16 * MIN }]);
    expect(await since('D')).toBe(T0);
    expect(await kinds('blocked')).toEqual(blocked);
    expect(await kinds('unblocked')).toEqual(unblocked);
    expect(await rows("SELECT 1 FROM messages WHERE kind = 'unblocked' AND sent_at > ?", T0)).toEqual([]);
  });

  it('a capability back in the recount that loses the resource\'s answer is that lost answer: silent, and only the lost row kept (B-49)', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    git.add('D', { requires: ['mcp-chrome'] }, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: [R] }] });
    await git.post();
    await cutover(T0);
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue', 'mcp-chrome'], [GO]);
    await w.beat({ capabilities: ['agent-venue'] });
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }] });
    expect(await blockRows('D')).toEqual([{ kind: 'capability', ref: 'mcp-chrome', leg: '', since: T0 }, { kind: 'resource', ref: R, leg: 'review', since: T0 }]);
    const [blocked, unblocked] = [await kinds('blocked'), await kinds('unblocked')];
    const evening = await since('D');
    // One heartbeat declares the capability again and stops using go_plus: its one recount clears
    // the capability row and, with no one left to answer for the resource, its row too. The
    // unblocking is the lost answer's: silent, keeping only the resource row (R-BTN-77).
    await setClock(T0 + 5 * MIN);
    await w.beat({ capabilities: ['agent-venue', 'mcp-chrome'], uses: [] });
    expect(await blockRows('D')).toEqual([]);
    expect(await since('D')).toBeNull();
    expect(await kinds('unblocked')).toEqual(unblocked);
    expect(await rows('SELECT answer_lost FROM tickets WHERE id = ?', 'docs:D')).toEqual([{ answer_lost: JSON.stringify({ since: evening, rows: [{ kind: 'resource', ref: R, leg: 'review' }] }) }]);
    // It uses go_plus again, still down: blocked again silently, since the evening.
    await setClock(T0 + 10 * MIN);
    await w.beat({ uses: [GO] });
    expect(await blockRows('D')).toEqual([{ kind: 'resource', ref: R, leg: 'review', since: T0 + 10 * MIN }]);
    expect(await since('D')).toBe(evening);
    expect(await kinds('blocked')).toEqual(blocked);
    expect(await kinds('unblocked')).toEqual(unblocked);
  });

  it('a lost resource row cleared with a real one in one alarm is the lost answer: silent, only the lost row kept (B-49)', async () => {
    const R2 = 'llm:glm-5';
    const GO2 = 'opencode-go:go_plus_2';
    for (const name of [R, R2]) await keyCall(admin, '/v1/admin/resources', { name, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    await keyCall(admin, '/v1/admin/instances', { name: GO2, serves: [R2], repositories: ['docs'] });
    git.add('D', {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: [R, R2] }] });
    await git.post();
    await cutover(T0);
    await grantedWorker(owner, 'docs', 'w1', ['agent-venue'], [GO]);
    const w2 = await grantedWorker(owner, 'docs', 'w2', ['agent-venue'], [GO2]);
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }, { instance: GO2, available: false, valid_for: 15 * 60 }] });
    expect(await blockRows('D')).toEqual([{ kind: 'resource', ref: R, leg: 'review', since: T0 }, { kind: 'resource', ref: R2, leg: 'review', since: T0 }]);
    const unblocked = await kinds('unblocked');
    // One tick: w1 has lapsed (no one left to answer for R: lost) and go_plus_2's reading has lapsed
    // (R2 open again, while w2 still uses it: a real clear). The ticket would still be blocked on
    // R had the fleet been able to answer, so the unblocking is the lost answer's (R-BTN-77).
    await setClock(T0 + 10 * MIN);
    await w2.beat();
    await setClock(T0 + 15 * MIN);
    await tick();
    expect(await blockRows('D')).toEqual([]);
    expect(await since('D')).toBeNull();
    expect(await kinds('unblocked')).toEqual(unblocked);
    expect(await rows('SELECT answer_lost FROM tickets WHERE id = ?', 'docs:D')).toEqual([{ answer_lost: JSON.stringify({ since: T0, rows: [{ kind: 'resource', ref: R, leg: 'review' }] }) }]);
  });

  it('a lost row on a next leg that is not queued silences nothing: a capability back in the same recount is logged (B-49, round 2)', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    git.add('D', { requires: ['mcp-chrome'] }, { ...placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready'], ['merge', 'waiting', 'ci']]),
      next: [{ leg: 'fix', state: 'ready' }, { leg: 'merge', state: 'waiting', waiting_on: 'ci', needs: [R] }] });
    await git.post();
    await cutover(T0);
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue', 'mcp-chrome'], [GO]);
    await w.beat({ capabilities: ['agent-venue'] });
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }] });
    expect((await blockRows('D')).map((r) => `${r.kind}:${r.leg}`)).toEqual(['capability:', 'resource:merge']);
    const unblocked = (await kinds('unblocked')).length;
    const messages = async () => (await rows("SELECT 1 FROM messages WHERE kind = 'unblocked'")).length;
    const sent = await messages();
    // One heartbeat brings the capability back and drops merge's only instance: merge's row is a lost
    // answer, but it never blocked D, whose queued leg is fix, so D's unblocking is logged and wakes work.
    await setClock(T0 + 5 * MIN);
    await w.beat({ capabilities: ['agent-venue', 'mcp-chrome'], uses: [] });
    expect(await blockRows('D')).toEqual([]);
    expect(await since('D')).toBeNull();
    expect((await kinds('unblocked')).length).toBe(unblocked + 1);
    expect(await messages()).toBe(sent + 1);
    // The unblocking names the capability alone: merge's lost row is not why D unblocked (round 3).
    const cleared = [{ kind: 'capability', ref: 'mcp-chrome' }];
    const event = (await rows<{ d: string }>(`SELECT detail_json AS d FROM events WHERE kind = 'unblocked' AND ticket_id = 'docs:D' ORDER BY seq DESC LIMIT 1`))[0];
    expect(JSON.parse(event.d).cleared).toEqual(cleared);
    const message = (await rows<{ p: string }>(`SELECT payload_json AS p FROM messages WHERE kind = 'unblocked' ORDER BY id DESC LIMIT 1`))[0];
    expect(JSON.stringify(JSON.parse(message.p))).toContain(JSON.stringify(cleared));
    expect(await rows('SELECT answer_lost FROM tickets WHERE id = ?', 'docs:D')).toEqual([{ answer_lost: null }]);
  });

  it('a lost row on a next leg that is not queued silences nothing: the queued leg\'s reading lapsing in the same tick is logged (B-49, round 2)', async () => {
    const R2 = 'llm:glm-5';
    const GO2 = 'opencode-go:go_plus_2';
    for (const name of [R, R2]) await keyCall(admin, '/v1/admin/resources', { name, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    await keyCall(admin, '/v1/admin/instances', { name: GO2, serves: [R2], repositories: ['docs'] });
    git.add('D', {}, { ...placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready'], ['merge', 'waiting', 'ci']]),
      next: [{ leg: 'fix', state: 'ready', needs: [R2] }, { leg: 'merge', state: 'waiting', waiting_on: 'ci', needs: [R] }] });
    await git.post();
    await cutover(T0);
    await grantedWorker(owner, 'docs', 'w1', ['agent-venue'], [GO]);
    const w2 = await grantedWorker(owner, 'docs', 'w2', ['agent-venue'], [GO2]);
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }, { instance: GO2, available: false, valid_for: 15 * 60 }] });
    expect(await since('D')).toBe(T0);
    const unblocked = (await kinds('unblocked')).length;
    // One tick: fix's reading lapses (a real clear on the queued leg) and w1, merge's only user, lapses
    // (merge's row lost). D is unblocked on fix for real: logged.
    await setClock(T0 + 10 * MIN);
    await w2.beat();
    await setClock(T0 + 15 * MIN);
    await tick();
    expect(await blockRows('D')).toEqual([]);
    expect(await since('D')).toBeNull();
    expect((await kinds('unblocked')).length).toBe(unblocked + 1);
    expect(await rows('SELECT answer_lost FROM tickets WHERE id = ?', 'docs:D')).toEqual([{ answer_lost: null }]);
  });

  it('the alarm evaluates once: a reading lapsing in the tick that raises baton:stalled logs nothing for a ticket blocked throughout (B-49)', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    git.add('D', {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'ci']]), next: [{ leg: 'review', state: 'waiting', waiting_on: 'ci', needs: [R] }] });
    await git.post();
    await cutover(T0);
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue'], [GO]);
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: STALLED_AFTER_MS / 1000 }] });
    expect(await blockRows('D')).toEqual([{ kind: 'resource', ref: R, leg: 'review', since: T0 }]);
    const [blocked, unblocked] = [await kinds('blocked'), await kinds('unblocked')];
    await setClock(T0 + STALLED_AFTER_MS - MIN);
    await w.beat();
    // At 72 hours the reading lapses (the resource row goes) and the stall raises baton:stalled (a
    // decision row comes) in one alarm: blocked throughout, so no event and the same blocked_since.
    await setClock(T0 + STALLED_AFTER_MS);
    await tick();
    expect(await blockRows('D')).toEqual([{ kind: 'decision', ref: 'baton:stalled', leg: '', since: T0 + STALLED_AFTER_MS }]);
    expect(await since('D')).toBe(T0);
    expect(await kinds('blocked')).toEqual(blocked);
    expect(await kinds('unblocked')).toEqual(unblocked);
  });

  it('a sync post evaluates once: closing baton:stalled and adding a dependency logs nothing for a ticket blocked throughout (B-49)', async () => {
    git.add('B', {}).add('S', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'ci']]));
    await git.post();
    await cutover(T0);
    await setClock(T0 + STALLED_AFTER_MS);
    await tick();
    expect(await blockRows('S')).toEqual([{ kind: 'decision', ref: 'baton:stalled', leg: '', since: T0 + STALLED_AFTER_MS }]);
    const [blocked, unblocked] = [await kinds('blocked'), await kinds('unblocked')];
    // One post: S's review is ready (baton:stalled closes, its row goes) and S is blocked by B (its
    // row comes in the post's own write).
    await setClock(T0 + STALLED_AFTER_MS + MIN);
    git.add('S', { blocked_by: ['B'] }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    expect(await blockRows('S')).toEqual([{ kind: 'ticket', ref: 'docs:B', leg: '', since: T0 + STALLED_AFTER_MS + MIN }]);
    expect(await since('S')).toBe(T0 + STALLED_AFTER_MS);
    expect(await kinds('blocked')).toEqual(blocked);
    expect(await kinds('unblocked')).toEqual(unblocked);
  });

  it('a post that moves the only ticket needing a resource past its leg is an unblocking, not a lost answer', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    git.add('D', {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: [R] }] });
    await git.post();
    await cutover(T0);
    await grantedWorker(owner, 'docs', 'w1', ['agent-venue'], [GO]);
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }] });
    expect(await since('D')).toBe(T0);
    // The sync places D past review: its need goes, and with it the fleet's count for R.
    git.place('D', placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['merge', 'ready']]));
    await git.post();
    expect(await rows('SELECT * FROM resource_fleet')).toEqual([]);
    expect(await since('D')).toBeNull();
    expect(await kinds('unblocked')).toEqual(['docs:D']);
    expect(await rows('SELECT answer_lost FROM tickets WHERE id = ?', 'docs:D')).toEqual([{ answer_lost: null }]);
  });

  it('two resources lost together: one coming back blocked re-blocks silently, its recovery unblocks once, and a later block of the other is logged', async () => {
    const R2 = 'llm:glm-5';
    const GO2 = 'acct:other';
    for (const name of [R, R2]) await keyCall(admin, '/v1/admin/resources', { name, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    await keyCall(admin, '/v1/admin/instances', { name: GO2, serves: [R2], repositories: ['docs'] });
    git.add('D', {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: [R, R2] }] });
    await git.post();
    await cutover(T0);
    const w1 = await grantedWorker(owner, 'docs', 'w1', ['agent-venue'], [GO]);
    const w2 = await grantedWorker(owner, 'docs', 'w2', ['agent-venue'], [GO2]);
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }, { instance: GO2, available: false, valid_for: 24 * 3600 }] });
    expect(await kinds('blocked')).toEqual(['docs:D']);
    // Both workers lapse: both rows are lost, silently.
    await setClock(T0 + 16 * MIN);
    await tick();
    expect(await since('D')).toBeNull();
    expect(JSON.parse((await rows<{ a: string }>('SELECT answer_lost AS a FROM tickets WHERE id = ?', 'docs:D'))[0].a).rows).toHaveLength(2);
    // W1 returns with R still down: re-blocked silently, from the evening; R2 still unanswerable.
    await w1.beat();
    expect(await since('D')).toBe(T0);
    expect(await kinds('blocked')).toEqual(['docs:D']);
    // R comes up: an ordinary unblocking, logged once, and the lost answer ends with it.
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: true, valid_for: 24 * 3600 }] });
    expect(await since('D')).toBeNull();
    expect(await kinds('unblocked')).toEqual(['docs:D']);
    expect(await rows('SELECT answer_lost FROM tickets WHERE id = ?', 'docs:D')).toEqual([{ answer_lost: null }]);
    // W2 returns with R2 still down: a new block, and logged as one.
    await w2.beat();
    expect(await since('D')).toBe(T0 + 16 * MIN);
    expect(await kinds('blocked')).toEqual(['docs:D', 'docs:D']);
    expect(await kinds('unblocked')).toEqual(['docs:D']);
  });

  it('a lost answer then a different block logs the owed `unblocked` before the new `blocked`, and wakes nobody', async () => {
    const R2 = 'llm:glm-5';
    const GO2 = 'acct:other';
    for (const name of [R, R2]) await keyCall(admin, '/v1/admin/resources', { name, scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: GO, serves: [R], repositories: ['docs'] });
    await keyCall(admin, '/v1/admin/instances', { name: GO2, serves: [R2], repositories: ['docs'] });
    git.add('D', {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: [R] }] });
    await git.post();
    await cutover(T0);
    await grantedWorker(owner, 'docs', 'w1', ['agent-venue'], [GO]);
    const w2 = await grantedWorker(owner, 'docs', 'w2', ['agent-venue'], [GO2]);
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: GO, available: false, valid_for: 24 * 3600 }, { instance: GO2, available: false, valid_for: 24 * 3600 }] });
    expect(await kinds('blocked')).toEqual(['docs:D']);
    // W1 lapses, W2 stays: the answer for R is lost silently.
    for (const t of [T0 + 8 * MIN, T0 + 16 * MIN]) {
      await setClock(t);
      await w2.beat();
      await tick();
    }
    expect(await since('D')).toBeNull();
    const messages = (await rows<{ n: number }>(`SELECT count(*) AS n FROM messages WHERE kind = 'unblocked'`))[0].n;
    // The sync moves D to merge, which needs R2 — down, and answered by W2.
    git.place('D', { ...placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['merge', 'ready']]), next: [{ leg: 'merge', state: 'ready', needs: [R2] }] });
    await git.post();
    expect(await rows(`SELECT kind, json_extract(detail_json, '$.cleared') AS c FROM events WHERE ticket_id = 'docs:D' AND kind IN ('blocked', 'unblocked') ORDER BY seq`)).toEqual([
      { kind: 'blocked', c: null },
      { kind: 'unblocked', c: JSON.stringify([{ kind: 'resource', ref: R, leg: 'review' }]) },
      { kind: 'blocked', c: null },
    ]);
    expect(await since('D')).toBe(T0 + 16 * MIN);
    expect(await rows('SELECT answer_lost FROM tickets WHERE id = ?', 'docs:D')).toEqual([{ answer_lost: null }]);
    expect((await rows<{ n: number }>(`SELECT count(*) AS n FROM messages WHERE kind = 'unblocked'`))[0].n).toBe(messages);
  });

  it('a well-formed need for an unregistered resource is reported and kept; registering it later takes effect', async () => {
    git.add('U', {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: ['llm:not-yet'] }] });
    expect(((await git.post()) as Record<string, unknown>).dropped).toEqual(['docs:U:needs:llm:not-yet:unregistered']);
    expect(await rows(`SELECT json_extract(detail_json, '$.dropped') AS d FROM events WHERE kind = 'snapshot-accepted' ORDER BY seq DESC LIMIT 1`)).toEqual([{ d: JSON.stringify(['docs:U:needs:llm:not-yet:unregistered']) }]);
    expect(await rows('SELECT leg, resource FROM leg_needs WHERE ticket_id = ?', 'docs:U')).toEqual([{ leg: 'review', resource: 'llm:not-yet' }]);
    expect(await blockRows('U')).toEqual([]);
    // Registered later, with an instance a live worker uses that is down: the kept need now blocks.
    await keyCall(admin, '/v1/admin/resources', { name: 'llm:not-yet', scope: 'account', detail_schema: SCHEMA });
    await keyCall(admin, '/v1/admin/instances', { name: 'acct:later', serves: ['llm:not-yet'], repositories: ['docs'] });
    await cutover(T0);
    await grantedWorker(owner, 'docs', 'wu', ['agent-venue'], ['acct:later']);
    await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'acct:later', available: false, valid_for: 3600 }] });
    expect(await blockRows('U')).toEqual([{ kind: 'resource', ref: 'llm:not-yet', leg: 'review', since: T0 }]);
  });
});

describe('R-BTN-77: unblocking wakes work, bounded', () => {
  it('150 tickets unblocked in one window dispatch 100 entries and {truncated: 50}', async () => {
    const sent: Workflow[] = [];
    await withCore((c) => {
      c.dispatcher = async (wf) => {
        sent.push(wf);
        return true;
      };
    });
    expect((await keyCall(owner, '/v1/owner/docs/settings', { unblocked_trigger: { kind: 'github-app', workflow: '.github/workflows/baton-unblocked.yml' } }, 'PUT')).status).toBe(200);
    const idle = await grantedWorker(owner, 'docs', 'idle', ['agent-venue']);
    git.add('Z');
    const many = Array.from({ length: 150 }, (_, i) => `M-${String(i).padStart(3, '0')}`);
    for (const id of many) git.add(id, { blocked_by: ['Z'] });
    expect((await git.post()).status).toBe(200);
    expect((await rows<{ n: number }>('SELECT count(*) AS n FROM tickets WHERE blocked_since IS NOT NULL'))[0].n).toBe(150);
    for (const id of many) git.tickets.get(id)!.blocked_by = [];
    expect((await git.post()).status).toBe(200);
    const dispatches = sent.filter((s) => s.kind === 'unblocked');
    expect(dispatches).toHaveLength(1);
    const tickets = dispatches[0].tickets as Record<string, unknown>[];
    expect(tickets).toHaveLength(101);
    expect(tickets.at(-1)).toEqual({ truncated: 50 });
    expect(tickets[0]).toEqual({ ticket: 'docs:M-000', cleared: [{ kind: 'ticket', ref: 'docs:Z' }] });
    // The idle worker's one message names the 20 latest (R-BTN-77), and a newer message supersedes
    // a delivered one it never acknowledged, so nothing piles up.
    const first = (await idle.beat()).json.messages.filter((m: { kind: string }) => m.kind === 'unblocked');
    expect(first).toHaveLength(1);
    expect(first[0].payload.tickets.map((t: { ticket_id: string }) => t.ticket_id)).toEqual(many.slice(-20).map((id) => `docs:${id}`));
    git.tickets.get(many[0])!.blocked_by = ['Z'];
    await git.post();
    git.tickets.get(many[0])!.blocked_by = [];
    await git.post();
    const second = (await idle.beat()).json.messages.filter((m: { kind: string }) => m.kind === 'unblocked');
    expect(second.map((m: { payload: { tickets: { ticket_id: string }[] } }) => m.payload.tickets.map((t) => t.ticket_id))).toEqual([['docs:M-000']]);
  });

});

describe('R-BTN-76, R-BTN-77: the alarm after a restart', () => {
  it('start() arms the alarm by the next reading to lapse and the trailing unblocked dispatch still owed', async () => {
    // Times ahead of the real clock: an alarm armed in the past fires (and clears) at once.
    const B = Math.ceil(Date.now() / 1000) * 1000 + 600_000;
    const restart = () => withCore(async (c) => {
      await (c as unknown as { ports: { scheduler: { set(at: number): Promise<void> } } }).ports.scheduler.set(B + 60_000);
      await c.start();
    });
    await withCore((c) => {
      c.store.exec(`INSERT INTO unblocked_dispatch (repository_id, last_sent_at, pending_json, due_at) VALUES ('docs', ?, '[]', ?)`, B - 30_000, B + 20_000);
      c.store.exec(`INSERT INTO instance_readings (instance, source, kind, available, observed_at, lapses_at, posted_by) VALUES (?, 'admin', 'state', 0, ?, ?, 'admin:x')`, GO, B - 30_000, B + 10_000);
    });
    await restart();
    expect(await armedAt()).toBe(B + 10_000);
    await rows('DELETE FROM instance_readings');
    await restart();
    expect(await armedAt()).toBe(B + 20_000);
  });
});

describe('R-BTN-75: asking', () => {
  it('transitive=1 follows ticket blocks along a chain, at most five levels', async () => {
    git.add('T0');
    let prev = 'T0';
    for (let i = 1; i <= 7; i++) {
      git.add(`T${i}`, { blocked_by: [prev] });
      prev = `T${i}`;
    }
    await git.post();
    const ask = async (q: string) => (await signed(owner, `/v1/repositories/docs/blocked?${q}`)).json;
    expect((await ask('on=ticket:T0')).tickets.map((t: { ticket_id: string }) => t.ticket_id)).toEqual(['docs:T1']);
    const deep = await ask('on=ticket:docs:T0&transitive=1');
    expect(deep.tickets.map((t: { ticket_id: string; level: number }) => [t.ticket_id, t.level])).toEqual([['docs:T1', 1], ['docs:T2', 2], ['docs:T3', 3], ['docs:T4', 4], ['docs:T5', 5]]);
    // With no `on`: every blocked ticket, grouped by kind and ref.
    const all = await ask('');
    expect(all.tickets).toHaveLength(7);
    expect(all.groups).toContainEqual({ kind: 'ticket', ref: 'docs:T0', tickets: ['docs:T1'] });
    expect(all.next_cursor).toBeUndefined();
    expect((await ask('on=nonsense')).code).toBe('invalid-params');
  });

  it('reads by index: blocks by primary key, blocked?on= through blocks_by_ref, the unfiltered page through tickets_blocked', async () => {
    // The very statements the queries run (BLOCK_SQL), so a change to one is planned here.
    const plan = (q: string, ...p: unknown[]) => withCore((c) => c.store.exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${q}`, ...p).toArray().map((r) => r.detail).join(' | '));
    expect(await plan(BLOCK_SQL.rows, 'docs:A')).toMatch(/USING (PRIMARY KEY|INDEX sqlite_autoindex_ticket_blocks_1)/);
    expect(await plan(BLOCK_SQL.on, 'docs', 'resource', '[]')).toMatch(/USING (COVERING )?INDEX blocks_by_ref/);
    expect(await plan(BLOCK_SQL.onAny, 'docs', 'decision')).toMatch(/USING (COVERING )?INDEX blocks_by_ref/);
    expect(await plan(BLOCK_SQL.page, 'docs', '', 101)).toMatch(/USING INDEX tickets_blocked/);
    expect(await plan('SELECT ticket_id FROM ticket_requires WHERE name = ?', 'x')).toMatch(/requires_by_name/);
    expect(await plan('SELECT ticket_id FROM leg_needs WHERE repository_id = ? AND resource = ?', 'docs', R)).toMatch(/needs_by_resource/);
  });
  it('`other` names each thing that keeps a ticket from being offered and is not a block, and only the bars that apply', async () => {
    await keyCall(admin, '/v1/admin/resources', { name: R, scope: 'account', detail_schema: SCHEMA });
    git.add('O', {}, { ...placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready'], ['merge', 'waiting', 'ci']]),
      next: [{ leg: 'fix', state: 'ready', needs: [R] }, { leg: 'merge', state: 'waiting', waiting_on: 'ci' }] });
    await git.post();
    await cutover(T0);
    const other = async () => (await withCore((c) => c.blocks.blocksOf('docs:O', null))).other;
    // No live worker: the resource need has no instance, and no bar is reported (nobody to bar).
    expect(await other()).toEqual([{ kind: 'waiting_on', detail: { leg: 'merge', on: 'ci' } }, { kind: 'no-instance', detail: { leg: 'fix', resource: R } }]);

    const w = await register('vm-a');
    await rows(`INSERT INTO worker_tags (worker_id, tag) VALUES (?, 'night')`, w.id);
    const bar = (course: string, tag: string, legs: string[]) => rows(`INSERT INTO owner_bars (repository_id, course, tag, legs, applies, starts_at, reason, set_by)
      VALUES ('docs', ?, ?, ?, 'claim', 0, 'test', 'owner:test') RETURNING id`, course, tag, JSON.stringify(legs)).then((r) => (r[0] as { id: number }).id);
    const every = await bar('*', 'night', []);
    const onFix = await bar('roadmap-pr', 'night', ['fix']);
    await bar('another-course', 'night', []); // another course: not this ticket's
    await bar('roadmap-pr', 'night', ['merge']); // a leg that is not queued
    await bar('*', 'day', []); // a tag the live worker lacks
    await rows(`INSERT INTO ticket_overrides (ticket_id, hold, hold_reason, retry_after, set_by, set_at) VALUES ('docs:O', 1, 'owner', ?, 'owner:test', 0)`, T0 + MIN);
    const active = await seedClaim(w.id, 'docs:O', T0);
    await rows(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, ended_at_sha) VALUES ('docs:O', ?, 'seed:done', 'abc124', '', ?, 'completed', ?, 'abc')`, w.id, T0, T0);
    await rows(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status, fence_pending, ended_at) VALUES ('docs:O', ?, 'seed:reaped', 'abc125', '', ?, 'reaped', 1, ?)`, w.id, T0, T0);
    const [done, reaped] = (await rows<{ id: number }>(`SELECT id FROM claims WHERE ticket_id = 'docs:O' AND status != 'active' ORDER BY id`)).map((r) => r.id);
    expect(await other()).toEqual([
      { kind: 'claimed', detail: { claim_id: active } },
      { kind: 'unconfirmed-end', detail: { claim_id: done } },
      { kind: 'fence-pending', detail: { claim_id: reaped } },
      { kind: 'hold', detail: { reason: 'owner' } },
      { kind: 'backoff', detail: { retry_after: T0 + MIN } },
      { kind: 'waiting_on', detail: { leg: 'merge', on: 'ci' } },
      { kind: 'bars', detail: { bar: every, tag: 'night' } },
      { kind: 'bars', detail: { bar: onFix, tag: 'night' } },
      { kind: 'no-instance', detail: { leg: 'fix', resource: R } },
    ]);
    // The backoff passes: no longer listed.
    await setClock(T0 + MIN);
    expect((await other()).map((o) => o.kind)).not.toContain('backoff');
  });
});
