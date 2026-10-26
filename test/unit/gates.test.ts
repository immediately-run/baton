// gates.test.ts — §7.2's gate table, R3-1232: every gate at a claim and at an advance, through the
// one pure function (`gatesFor`) the candidate query mirrors (G-BTN-40), and every advice input
// accepted and recorded, never refused (R-BTN-45, S-BTN-24).
import { describe, it, expect, beforeEach } from 'vitest';
import { gatesFor, type GateContext, type GateLeg, type GateTicket, type GateWorker } from '../../src/core/gates';
import { claimItem, cutover, payload, recommended, register, rows, setClock, syncCall, seedClaim } from '../helpers';
import { inject } from 'vitest';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const worker = (over: Partial<GateWorker> = {}): GateWorker => ({
  declared: ['agent-venue'], tier_ceiling: 'critical', tags: ['family:glm'], courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }], grants: null, ...over,
});
const ticket = (over: Partial<GateTicket> = {}): GateTicket => ({
  repository: 'docs', course: 'roadmap-pr', tier: 'judgement', requires: ['agent-venue'], operator_only: false, tiers: ['routine', 'judgement', 'critical'], ...over,
});
const leg = (over: Partial<GateLeg> = {}): GateLeg => ({ name: 'fix', state: 'ready', bars: [], ...over });
const facts = (over: Partial<GateContext> = {}): GateContext => ({
  now: T0, claims: [], override: null, minWorkerVersion: 3, headObservation: 5, lastEndObservation: 4, ...over,
});

describe('gatesFor: every gate of the table', () => {
  it('passes a ticket that meets them all, at a claim and at an advance', () => {
    expect(gatesFor(worker(), ticket(), leg(), 'claim', facts())).toEqual({ ok: true });
    expect(gatesFor(worker(), ticket(), leg(), 'advance', facts())).toEqual({ ok: true });
  });

  // [gate, the input that fails it, the verdict at a claim, the verdict at an advance (null: passes)]
  const cases: [string, () => Parameters<typeof gatesFor>, { rule: number | string; code: string }, { rule: number | string; code: string } | null][] = [
    ['rule 1: the queued leg is not ready', () => [worker(), ticket(), leg({ state: 'waiting' }), 'claim', facts()], { rule: 1, code: 'not-ready' }, null],
    ['rule 1: a leg no snapshot posted', () => [worker(), ticket(), leg({ state: null }), 'claim', facts()], { rule: 1, code: 'not-ready' }, null],
    ['§6.7: no sync since the last end', () => [worker(), ticket(), leg(), 'claim', facts({ headObservation: 4 })], { rule: 1, code: 'awaiting-sync' }, null],
    ['rule 3: an active claim', () => [worker(), ticket(), leg(), 'claim', facts({ claims: [{ status: 'active', confirmed_at: null, fence_pending: 0 }] })], { rule: 3, code: 'claimed' }, null],
    ['rule 3: an unconfirmed completion', () => [worker(), ticket(), leg(), 'claim', facts({ claims: [{ status: 'completed', confirmed_at: null, fence_pending: 0 }] })], { rule: 3, code: 'claimed' }, null],
    ['rule 3: a fence-pending reap', () => [worker(), ticket(), leg(), 'claim', facts({ claims: [{ status: 'reaped', confirmed_at: null, fence_pending: 1 }] })], { rule: 3, code: 'claimed' }, null],
    ['rule 3: a hold', () => [worker(), ticket(), leg(), 'claim', facts({ override: { hold: 1, retry_after: null } })], { rule: 3, code: 'held' }, { rule: 3, code: 'held' }],
    ['rule 4: a missing capability', () => [worker({ declared: [] }), ticket(), leg(), 'claim', facts()], { rule: 4, code: 'missing-capability' }, { rule: 4, code: 'missing-capability' }],
    ['rule 4: the leg’s own requires names a capability the worker lacks (R-BTN-120)', () => [worker({ declared: ['llm-call'] }), ticket({ requires: [] }), leg({ requires: ['create-pr'] }), 'claim', facts()], { rule: 4, code: 'missing-capability' }, { rule: 4, code: 'missing-capability' }],
    ['rule 5: above the tier ceiling', () => [worker({ tier_ceiling: 'routine' }), ticket(), leg(), 'claim', facts()], { rule: 5, code: 'above-tier-ceiling' }, { rule: 5, code: 'above-tier-ceiling' }],
    ['rule 6: operator-only', () => [worker(), ticket({ operator_only: true }), leg(), 'claim', facts()], { rule: 6, code: 'operator-only' }, { rule: 6, code: 'operator-only' }],
    ['rule 8: a posted barred tag', () => [worker(), ticket(), leg({ bars: ['family:glm'] }), 'claim', facts()], { rule: 8, code: 'barred-tag' }, { rule: 8, code: 'barred-tag' }],
    ['rule 9: an older course version', () => [worker({ courses: [{ repository: 'docs', course: 'roadmap-pr', version: 2 }] }), ticket(), leg(), 'claim', facts()], { rule: 9, code: 'stale-skills' }, null],
    ['rule 9: a course not declared', () => [worker({ courses: [] }), ticket(), leg(), 'claim', facts()], { rule: 9, code: 'stale-skills' }, null],
    ['chain (R-BTN-106): the key ran a leg this one names', () => [worker(), ticket(), leg({ noChainFrom: ['implement'] }), 'claim', facts({ ranByKey: ['implement'] })], { rule: 'chain', code: 'chain' }, { rule: 'chain', code: 'chain' }],
    ['isolation (R-BTN-107): a session floor, a process worker', () => [worker(), ticket(), leg({ isolation: 'session' }), 'claim', facts()], { rule: 'isolation', code: 'isolation' }, { rule: 'isolation', code: 'isolation' }],
    ['isolation (R-BTN-107): a session floor, an attached worker', () => [worker({ isolation: 'attached' }), ticket(), leg({ isolation: 'session' }), 'claim', facts()], { rule: 'isolation', code: 'isolation' }, { rule: 'isolation', code: 'isolation' }],
    ['rule 10: backing off', () => [worker(), ticket(), leg(), 'claim', facts({ override: { hold: 0, retry_after: T0 + 1 } })], { rule: 10, code: 'backing-off' }, { rule: 10, code: 'backing-off' }],
  ];
  it.each(cases)('%s', (_name, args, atClaim, atAdvance) => {
    const [w, t, l, , f] = args();
    expect(gatesFor(w, t, l, 'claim', f)).toEqual({ ok: false, ...atClaim });
    expect(gatesFor(w, t, l, 'advance', f)).toEqual(atAdvance ? { ok: false, ...atAdvance } : { ok: true });
  });

  it('chain and isolation pass a key that ran none of the named legs, and a session worker', () => {
    expect(gatesFor(worker(), ticket(), leg({ noChainFrom: ['implement', 'fix'] }), 'advance', facts({ ranByKey: ['review'] }))).toEqual({ ok: true });
    expect(gatesFor(worker(), ticket(), leg({ noChainFrom: [] }), 'claim', facts({ ranByKey: ['implement'] }))).toEqual({ ok: true });
    expect(gatesFor(worker({ isolation: 'session' }), ticket(), leg({ isolation: 'session' }), 'claim', facts())).toEqual({ ok: true });
    // No floor: any declared mode takes the leg.
    expect(gatesFor(worker({ isolation: 'attached' }), ticket(), leg({ isolation: null }), 'claim', facts())).toEqual({ ok: true });
  });

  it('rule 8 at an advance joins the holder’s own bars to the posted ones, which only add', () => {
    expect(gatesFor(worker(), ticket(), leg(), 'advance', facts({ holderBars: ['family:glm'] }))).toEqual({ ok: false, rule: 8, code: 'barred-tag' });
    expect(gatesFor(worker(), ticket(), leg(), 'advance', facts({ holderBars: ['family:qwen'] }))).toEqual({ ok: true });
    // A claim never reads holder bars: there is no holder yet.
    expect(gatesFor(worker(), ticket(), leg(), 'claim', facts({ holderBars: ['family:glm'] }))).toEqual({ ok: true });
  });

  it('rule 4 reads the leg\'s requires beside the ticket\'s clause (R-BTN-120, B-86)', () => {
    // The leg the worker lacks: refused at a claim and at an advance, even with the clause met.
    expect(gatesFor(worker({ declared: ['llm-call'] }), ticket({ requires: [] }), leg({ requires: ['create-pr'] }), 'claim', facts())).toEqual({ ok: false, rule: 4, code: 'missing-capability' });
    expect(gatesFor(worker({ declared: ['llm-call'] }), ticket(), leg({ requires: ['create-pr'] }), 'advance', facts())).toEqual({ ok: false, rule: 4, code: 'missing-capability' });
    // Held: it passes, whether by the capability or through the role that carries it.
    expect(gatesFor(worker({ declared: ['create-pr'] }), ticket({ requires: [] }), leg({ requires: ['create-pr'] }), 'claim', facts())).toEqual({ ok: true });
    // Review round 5, finding 0: a role on the leg side is read as on the clause side — one of the
    // role's four does not stand for the role. `graphOf` hands rule 4 the role's capabilities
    // (`legCapabilities` is the one expansion point, `graph.test` covers it), so a leg carries the
    // four; a partial declaration is refused at a claim and at an advance, the full one passes.
    const venue = ['authentication', 'llm-call', 'create-pr', 'drivable-browser'];
    expect(gatesFor(worker({ declared: ['agent-venue'] }), ticket({ requires: [] }), leg({ requires: venue }), 'claim', facts())).toEqual({ ok: true });
    expect(gatesFor(worker({ declared: ['llm-call'] }), ticket({ requires: [] }), leg({ requires: venue }), 'claim', facts())).toEqual({ ok: false, rule: 4, code: 'missing-capability' });
    expect(gatesFor(worker({ declared: ['llm-call'] }), ticket({ requires: [] }), leg({ requires: venue }), 'advance', facts())).toEqual({ ok: false, rule: 4, code: 'missing-capability' });
    // A partial grant is refused too: the declaration holds all four, the grant three.
    expect(gatesFor(worker({ declared: ['agent-venue'], grants: { docs: { capabilities: ['authentication', 'llm-call', 'create-pr'] } } }), ticket({ requires: [] }), leg({ requires: venue }), 'claim', facts())).toEqual({ ok: false, rule: 4, code: 'missing-capability' });
    // The full declaration on the full grant passes.
    expect(gatesFor(worker({ declared: ['agent-venue'], grants: { docs: { capabilities: venue } } }), ticket({ requires: [] }), leg({ requires: venue }), 'claim', facts())).toEqual({ ok: true });
    // A leg with no `requires` (and one that requires nothing) is unchanged.
    expect(gatesFor(worker({ declared: ['agent-venue'] }), ticket({ requires: [] }), leg(), 'claim', facts())).toEqual({ ok: true });
    expect(gatesFor(worker({ declared: ['agent-venue'] }), ticket({ requires: [] }), leg({ requires: [] }), 'claim', facts())).toEqual({ ok: true });
    // Within the grant too (rule 4's second half): a name the key's grant excludes is refused.
    expect(gatesFor(worker({ declared: ['agent-venue'], grants: { docs: { capabilities: ['authentication', 'drivable-browser', 'llm-call'] } } }), ticket({ requires: [] }), leg({ requires: ['create-pr'] }), 'claim', facts())).toEqual({ ok: false, rule: 4, code: 'missing-capability' });
  });

  it('rule 4 reads human-operator on the leg side as rule 6 reads it (R-BTN-121, review round 6)', () => {
    const hands = leg({ requires: ['human-operator'] });
    // An autonomous agent-venue worker is refused: the venue's four are never the operator, whether
    // the key is ungranted, granted the venue's four, or granted them plus the literal.
    for (const grants of [null, { docs: { capabilities: ['authentication', 'llm-call', 'create-pr', 'drivable-browser'] } }, { docs: { capabilities: ['authentication', 'llm-call', 'create-pr', 'drivable-browser', 'human-operator'] } }]) {
      expect(gatesFor(worker({ declared: ['agent-venue'], grants }), ticket({ requires: [] }), hands, 'claim', facts()), JSON.stringify(grants)).toEqual({ ok: false, rule: 4, code: 'missing-capability' });
      expect(gatesFor(worker({ declared: ['agent-venue'], grants }), ticket({ requires: [] }), hands, 'advance', facts())).toEqual({ ok: false, rule: 4, code: 'missing-capability' });
    }
    // A worker declaring the literal passes, ungranted or granted it.
    expect(gatesFor(worker({ declared: ['human-operator'], grants: null }), ticket({ requires: [] }), hands, 'claim', facts())).toEqual({ ok: true });
    expect(gatesFor(worker({ declared: ['human-operator'], grants: null }), ticket({ requires: [] }), hands, 'advance', facts())).toEqual({ ok: true });
    expect(gatesFor(worker({ declared: ['human-operator', 'agent-venue'], grants: { docs: { capabilities: [...['authentication', 'llm-call', 'create-pr', 'drivable-browser'], 'human-operator'] } } }), ticket({ requires: [] }), hands, 'claim', facts())).toEqual({ ok: true });
    // Within the grant as rule 6 checks it: declaring it is not enough for a granted key the grant leaves out.
    expect(gatesFor(worker({ declared: ['human-operator'], grants: { docs: { capabilities: ['llm-call'] } } }), ticket({ requires: [] }), hands, 'claim', facts())).toEqual({ ok: false, rule: 4, code: 'missing-capability' });
  });

  it('an untiered ticket fits only the top tier; a role in the clause needs all its capabilities', () => {
    expect(gatesFor(worker({ tier_ceiling: 'judgement' }), ticket({ tier: null }), leg(), 'claim', facts())).toMatchObject({ rule: 5 });
    expect(gatesFor(worker({ declared: ['agent-venue'] }), ticket({ requires: ['authentication', 'llm-call'] }), leg(), 'claim', facts())).toEqual({ ok: true });
    expect(gatesFor(worker({ declared: ['llm-call'] }), ticket({ requires: ['agent-venue'] }), leg(), 'claim', facts())).toMatchObject({ rule: 4 });
  });
});

const board = inject('board');

describe('advice is never a gate (R-BTN-45, S-BTN-24): every advice input is accepted and recorded', () => {
  beforeEach(async () => {
    await setClock(T0);
    await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A));
    await cutover();
  });

  it('the order: a ticket claimed past the first recommendation records its place and the first', async () => {
    const w = await register('vm-a');
    expect(await recommended(w.id)).toEqual(['docs:R3-9001', 'docs:R3-9002']);
    const c = await claimItem('vm-a', w.secret, { ticket_id: 'docs:R3-9002' });
    expect(c.status).toBe(200);
    expect(JSON.parse((await rows<{ advice_json: string }>('SELECT advice_json FROM claims WHERE id = ?', c.json.claim_id))[0].advice_json))
      .toMatchObject({ overridden: [{ advice: 'order', place: 2, first: 'docs:R3-9001' }] });
    expect(await rows(`SELECT actor FROM events WHERE kind = 'advice-overridden' AND claim_id = ?`, c.json.claim_id)).toEqual([{ actor: `worker:${w.id}` }]);
  });

  it('the first recommendation, claimed by name or not, records the recommendation and no override', async () => {
    const w = await register('vm-a');
    const c = await claimItem('vm-a', w.secret, { ticket_id: 'docs:R3-9001' });
    expect(JSON.parse((await rows<{ advice_json: string }>('SELECT advice_json FROM claims WHERE id = ?', c.json.claim_id))[0].advice_json))
      .toEqual({ recommendation: expect.objectContaining({ ticket_id: 'docs:R3-9001', legs: ['implement'] }) });
    expect(await rows(`SELECT 1 FROM events WHERE kind = 'advice-overridden'`)).toEqual([]);
  });

  it('the expedite lane’s bound: over it, an expedited ticket is still claimable, its override recorded', async () => {
    for (const t of ['R3-9001', 'R3-9002', 'R3-9004']) await rows(`INSERT INTO ticket_overrides (ticket_id, expedite, set_by, set_at) VALUES (?, 1, 'owner:test', 0)`, `docs:${t}`);
    const a = await register('vm-a');
    const b = await register('vm-b');
    await seedClaim(a.id, 'docs:R3-9004');
    await seedClaim(b.id, 'docs:R3-9002');
    const t = await register('test');
    const c = await claimItem('test', t.secret, { ticket_id: 'docs:R3-9001' });
    expect(c.status).toBe(200);
    expect(JSON.parse((await rows<{ advice_json: string }>('SELECT advice_json FROM claims WHERE id = ?', c.json.claim_id))[0].advice_json).overridden)
      .toEqual(expect.arrayContaining([{ advice: 'expedite-bound', bound: 2 }]));
  });
});
