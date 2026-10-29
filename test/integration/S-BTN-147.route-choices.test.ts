// S-BTN-147 to S-BTN-154 and G-BTN-161 (BATON_SPEC §15, §6.10 R-BTN-176/R-BTN-177; B-105), on
// both hosts: route choices end to end — a codegen choice over two providers with a peak rule,
// a reviewer choice with hysteresis over an API-capacity reading, who may steer (atoms_from),
// the atom shapes, schema refinement against std:api-capacity@1, the strata and reserved names
// a program may not cross, delivery and overrides through claim_legs and taken, and the counted
// bound (limit) through the test bindings. The clingo half of S-BTN-154 is the conformance
// suite (test/unit/ontology-conformance.test.ts); the runner's BATON_ADVICE and BATON_TAKEN are
// runner-main's.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { keyCall, payload, course, refresh, requestId, rows, setAdminKeys, setClock, syncCall, tick, withCore, cutover } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { grantedWorker, type FleetWorker } from '../lib/fleet';

const board = inject('board');
const sha = board.shas;
/** Thursday 2026-10-29, 06:00Z — minute of day 360, inside the peak rule's [120, 600). */
const T0 = Date.parse('2026-10-29T06:00:00Z');
const MIN = 60_000;

/** The program S-BTN-147/148 prescribe: codegen over OpenCode Go and DeepInfra with a peak
 *  rule, reviewer-2 over Opus and GLM with near_limit's two thresholds, meters facts. */
const program = {
  version: 1,
  builtin: 'baton@1',
  derived: ['capability', 'model'],
  entries: [
    { id: 'offers-ocg-dsflash', fact: ['offers', 'key:opencode-go', 'model:deepseek-v4.1-flash'] },
    { id: 'offers-di-dsflash', fact: ['offers', 'key:deepinfra', 'model:deepseek-v4.1-flash'] },
    { id: 'offers-sub-opus', fact: ['offers', 'key:claude-subscription', 'model:claude-opus-5-5'] },
    { id: 'offers-zai-glm', fact: ['offers', 'key:zai', 'model:glm-5.3'] },
    { id: 'meters-ocg', fact: ['meters', 'key:opencode-go', 'opencode-go'] },
    { id: 'meters-di', fact: ['meters', 'key:deepinfra', 'deepinfra'] },
    { id: 'meters-sub', fact: ['meters', 'key:claude-subscription', 'anthropic-capacity'] },
    { id: 'direct-model', head: ['derived', '$m'], body: [['offers', '$k', '$m'], ['holds', '$k']] },
    { id: 'ocg-peak', head: ['ocg_peak'], body: [['now', 'utc_minute_of_day', '$t'], { cmp: ['$t', '>=', 120] }, { cmp: ['$t', '<', 600] }] },
    { id: 'near-enter', head: ['near_limit', '$i'], body: [['refines', '$r', 'std:api-capacity@1'], ['usable', '$r', '$i'], ['int', '$i', 'remaining_permille', '$v'], { cmp: ['$v', '<', 200] }] },
    { id: 'near-hold', head: ['near_limit', '$i'], body: [['refines', '$r', 'std:api-capacity@1'], ['usable', '$r', '$i'], ['int', '$i', 'remaining_permille', '$v'], { cmp: ['$v', '<', 300] }, ['was_demoted', 'reviewer-2', 'opus']] },
  ],
  route_choices: [
    {
      id: 'codegen',
      alternatives: [
        { id: 'opencode-go', needs: ['model:deepseek-v4.1-flash', 'key:opencode-go'], demote_when: [[['ocg_peak']]] },
        { id: 'deepinfra', needs: ['model:deepseek-v4.1-flash', 'key:deepinfra'] },
      ],
    },
    {
      id: 'reviewer-2',
      alternatives: [
        { id: 'opus', needs: ['model:claude-opus-5-5', 'key:claude-subscription'], demote_when: [[['near_limit', '$i']]] },
        { id: 'glm', needs: ['model:glm-5.3', 'key:zai'] },
      ],
    },
  ],
};

/** The schema anthropic-capacity and its kin register: a refinement of std:api-capacity@1 —
 *  the base's own fields restated (it is open: a provider's schema refines it by adding fields),
 *  its remaining_permille bounded as the base bounds it. */
const CAPACITY_BASE = { type: 'object', properties: { window_s: { type: 'integer', minimum: 1 }, remaining_permille: { type: 'integer', minimum: 0, maximum: 1000 }, resets_at_min: { type: 'integer', minimum: 0 } }, required: ['window_s', 'remaining_permille'], 'x-baton-base': 'std:api-capacity@1' };
const ALL_KEYS = ['key:opencode-go', 'key:deepinfra', 'key:claude-subscription', 'key:zai'];

let admin: TestKey;
let owner: TestKey;
/** Each board post needs a fresh head over the last (§7.1): the fixture's four, then random
 *  40-hex ones — the sync checks shape and order, not the forge. */
let head: string | null = null;
let headNo = 0;
const nextHead = () => {
  const sha = (board.shas as Record<string, string>)[String.fromCharCode(65 + headNo++)] ?? [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const parent = head;
  head = sha;
  return { sha, parent };
};


/** One ticket of the fixture, cloned under a fresh id. */
const item = (id: string) => {
  const base = structuredClone((board.states.A.state.items as Record<string, unknown>[]).find((i) => i.id === 'R3-9001')) as Record<string, unknown>;
  return { ...base, id, requires: ['none'] };
};

/** Post the board with the program and the route choices a leg carries, plus fresh tickets. */
async function postBoard(routeChoices: Record<string, string[]>, ids: string[]) {
  routeChoices = Object.keys(routeChoices).length ? routeChoices : { implement: ['codegen'], review: ['reviewer-2'] };
  const { sha: at, parent } = nextHead();
  const res = await syncCall('/v1/sync/board', payload(at, parent, board.states.A, {
    ontology: { builtin: 'baton@1', program },
    registry: [course(3, 3, { route_choices: routeChoices })],
    state: { items: ids.map(item) },
    ready: ids,
  }));
  expect(res.status).toBe(200);
}

/** Claim a ticket and start its first leg, answering the claim id and the advance's advice. */
async function startLeg(w: FleetWorker, id: string) {
  const claim = await w.call('/v1/runner/claim', { request_id: requestId(), ticket_id: `docs:${id}` });
  expect(claim.status).toBe(200);
  const claimId = claim.json.claim_id as number;
  expect(claim.json.advice).toBeNull(); // a claim runs nothing: no advice (R-BTN-177)
  const adv = await w.call(`/v1/runner/claims/${claimId}/advance`, { leg: 'implement' });
  expect(adv.status).toBe(200);
  return { claimId, advice: adv.json.advice as { route_choices: { choice: string; alternative: string | null; ranked: { alternative: string; demoted: boolean }[]; reason?: string }[] } | null };
}

const alternativeOf = (advice: { route_choices: { choice: string; alternative: string | null }[] } | null, choice: string) =>
  advice?.route_choices.find((r) => r.choice === choice)?.alternative;

beforeEach(async () => {
  await setClock(T0);
  head = null; // each test's board starts fresh: the fixture's A over no parent
  headNo = 0;
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  for (const [name, schema, atoms] of [['opencode-go', { type: 'object' }, undefined], ['deepinfra', { type: 'object' }, undefined], ['anthropic-capacity', CAPACITY_BASE, 'any']] as const) {
    const res = await keyCall(admin, '/v1/admin/resources', { name, scope: 'account', detail_schema: schema, ...(atoms ? { atoms_from: atoms } : {}) });
    expect(res.status, name).toBe(200);
  }
  for (const [instance, serves] of [['ocg:go-plus', ['opencode-go']], ['di:main', ['deepinfra']], ['ac:main', ['anthropic-capacity']]] as const) {
    expect((await keyCall(admin, '/v1/admin/instances', { name: instance, serves, repositories: ['docs'] })).status).toBe(200);
  }
  await postBoard({ implement: ['codegen'], review: ['reviewer-2'] }, ['R3-9101']);
  await cutover(T0);
});

describe('S-BTN-147: a codegen route choice', () => {
  it('in peak DeepInfra, off-peak OpenCode Go, a blocked provider demoted-not-excluded, a narrower worker, none available', async () => {
    const w1 = await grantedWorker(owner, 'docs', 'w1', ALL_KEYS, ['ocg:go-plus', 'di:main']);
    // T0 is 06:00Z: in peak. OpenCode Go is demoted behind the undemoted DeepInfra.
    const peak = await startLeg(w1, 'R3-9101');
    expect(alternativeOf(peak.advice, 'codegen')).toBe('deepinfra');
    expect(peak.advice!.route_choices[0].ranked.map((r) => r.alternative)).toEqual(['deepinfra', 'opencode-go']);
    expect(peak.advice!.route_choices[0].ranked[1].demoted).toBe(true);
    await w1.call(`/v1/runner/claims/${peak.claimId}/end`, { end_reason: 'released:requested' });

    // 11:00Z: off-peak, OpenCode Go first.
    await setClock(T0 + 5 * 60 * MIN);
    await w1.beat();
    await postBoard({}, ['R3-9102']);
    await refresh();
    const offPeak = await startLeg(w1, 'R3-9102');
    expect(alternativeOf(offPeak.advice, 'codegen')).toBe('opencode-go');
    await w1.call(`/v1/runner/claims/${offPeak.claimId}/end`, { end_reason: 'released:requested' });

    // In peak with DeepInfra unavailable: the demoted OpenCode Go is still advised — a guard is
    // soft, a blocked need is not, and this is the row's fallback clause (S-BTN-147).
    await setClock(T0 + 21 * 60 * MIN); // next day 03:00Z — minute 180, inside [120, 600)
    await w1.beat();
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'di:main', available: false, valid_for: 86400 }] })).status).toBe(200);
    await postBoard({}, ['R3-9103']);
    await refresh();
    const diDownInPeak = await startLeg(w1, 'R3-9103');
    expect(alternativeOf(diDownInPeak.advice, 'codegen')).toBe('opencode-go'); // blocked_alt removes deepinfra; the demoted first survives
    expect(diDownInPeak.advice!.route_choices[0].ranked.map((r) => r.alternative)).toEqual(['opencode-go']);
    expect(diDownInPeak.advice!.route_choices[0].ranked[0].demoted).toBe(true);
    await w1.call(`/v1/runner/claims/${diDownInPeak.claimId}/end`, { end_reason: 'released:requested' });

    // Off-peak with OpenCode Go unavailable: DeepInfra.
    await setClock(T0 + 28 * 60 * MIN); // 10:00Z — minute 600, off-peak (the window ends at 600)
    await w1.beat();
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'ocg:go-plus', available: false, valid_for: 86400 }, { instance: 'di:main', available: true, valid_for: 86400 }] })).status).toBe(200);
    await postBoard({}, ['R3-9104']);
    await refresh();
    const ocgDown = await startLeg(w1, 'R3-9104');
    expect(alternativeOf(ocgDown.advice, 'codegen')).toBe('deepinfra');
    await w1.call(`/v1/runner/claims/${ocgDown.claimId}/end`, { end_reason: 'released:requested' });

    // A runner holding only DeepInfra's key: deepinfra, whatever the clock.
    const w2 = await grantedWorker(owner, 'docs', 'w2', ['key:deepinfra'], ['di:main']);
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'di:main', available: true, valid_for: 86400 }] })).status).toBe(200);
    await postBoard({}, ['R3-9105']);
    await refresh();
    const onlyDi = await startLeg(w2, 'R3-9105');
    expect(alternativeOf(onlyDi.advice, 'codegen')).toBe('deepinfra');
    await w2.call(`/v1/runner/claims/${onlyDi.claimId}/end`, { end_reason: 'released:requested' });

    // A runner holding neither key: null with none-available.
    const w3 = await grantedWorker(owner, 'docs', 'w3', ['agent-venue'], []);
    await postBoard({}, ['R3-9106']);
    await refresh();
    const none = await startLeg(w3, 'R3-9106');
    expect(alternativeOf(none.advice, 'codegen')).toBeNull();
    expect(none.advice!.route_choices[0].reason).toBe('none-available');
    expect(none.advice!.route_choices[0].ranked).toEqual([]);
  });
});

describe('S-BTN-148: a reviewer route choice with hysteresis', () => {
  /** W1's reviewer-2 resolution, on a fresh ticket, after the current ac:main reading. */
  async function resolve(w: FleetWorker, id: string) {
    await postBoard({ implement: ['reviewer-2'] }, [id]);
    const out = await startLeg(w, id);
    expect(alternativeOf(out.advice, 'reviewer-2')).toBeDefined();
    await w.call(`/v1/runner/claims/${out.claimId}/end`, { end_reason: 'released:requested' });
    return alternativeOf(out.advice, 'reviewer-2');
  }

  it('500 opus, 150 glm, 250 glm (held), a detail-less state keeps the fields, 320 opus, lapsed opus, an administrator unavailable glm; another runner never moves them', async () => {
    const w1 = await grantedWorker(owner, 'docs', 'w1', ALL_KEYS, ['ac:main']);
    const w2 = await grantedWorker(owner, 'docs', 'w2', ALL_KEYS, []); // no usable instance of anthropic-capacity
    const reading = async (at: number, body: Record<string, unknown>) => {
      await setClock(at);
      await w1.beat();
      const res = await w1.call('/v1/runner/readings', { readings: [{ instance: 'ac:main', valid_for: 3600, ...body }] });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.refused).toEqual([]);
    };
    let t = T0;
    let stepNo = 0;
    const step = async (body: Record<string, unknown>, by = 2 * MIN) => { t += by; await reading(t, body); };
    const w1Rows = async () => (await rows<{ choice: string; alternative: string; demoted: number }>('SELECT choice, alternative, demoted FROM route_last WHERE worker_id = ? ORDER BY choice, alternative', w1.id));
    /** W2 resolves between each step (S-BTN-148) and never moves W1's rows — keyed by runner,
     *  the demotion's hysteresis is W1's alone. */
    const betweenSteps = async () => {
      const before = await w1Rows();
      const id = `R3-93${String(++stepNo).padStart(2, '0')}`;
      await postBoard({ implement: ['reviewer-2'] }, [id]);
      const w2out = await startLeg(w2, id);
      expect(alternativeOf(w2out.advice, 'reviewer-2')).toBe('opus'); // no usable instance: fails open
      await w2.call(`/v1/runner/claims/${w2out.claimId}/end`, { end_reason: 'released:requested' });
      expect(await w1Rows()).toEqual(before);
    };

    await step({ available: true, detail: { window_s: 300, remaining_permille: 500 } });
    expect(await resolve(w1, 'R3-9201')).toBe('opus');
    await betweenSteps();

    await step({ available: true, detail: { window_s: 300, remaining_permille: 150 } });
    expect(await resolve(w1, 'R3-9202')).toBe('glm');
    await betweenSteps(); // W1 demoted: the moment keying by runner matters
    await step({ available: true, detail: { window_s: 300, remaining_permille: 250 } });
    expect(await resolve(w1, 'R3-9203')).toBe('glm'); // held below 300 by was_demoted
    await betweenSteps();
    // A state reading with no detail: the field reading stays at 250.
    await step({ available: true });
    expect(await resolve(w1, 'R3-9204')).toBe('glm');
    await betweenSteps();
    await step({ available: true, detail: { window_s: 300, remaining_permille: 320 } });
    expect(await resolve(w1, 'R3-9205')).toBe('opus');
    await betweenSteps();
    // Every reading lapsed: unknown, no fields — fails open, and the demotion is history.
    await setClock(t + 2 * 60 * MIN);
    await w1.beat();
    await tick();
    expect(await resolve(w1, 'R3-9206')).toBe('opus');
    const afterLapse = await w1Rows();
    expect(afterLapse.find((r) => r.alternative === 'opus')!.demoted).toBe(0);
    // An administrator's unavailable: blocked, glm.
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'ac:main', available: false, valid_for: 86400 }] })).status).toBe(200);
    expect(await resolve(w1, 'R3-9207')).toBe('glm');
  });

  it('a fail-closed rule over state(I, "unknown") demotes when nothing is known', async () => {
    const failClosed = structuredClone(program);
    (failClosed.route_choices as { id: string; alternatives: { id: string; needs: string[]; demote_when?: unknown[][] }[] }[])[1].alternatives[0].demote_when = [[['near_limit', '$i']], [['state', '$i', 'unknown']]];
    const h = nextHead();
    const res = await syncCall('/v1/sync/board', payload(h.sha, h.parent, board.states.A, {
      ontology: { builtin: 'baton@1', program: failClosed },
      registry: [course(3, 3, { route_choices: { implement: ['reviewer-2'] } })],
      state: { items: [item('R3-9211')] },
      ready: ['R3-9211'],
    }));
    expect(res.status).toBe(200);
    const w = await grantedWorker(owner, 'docs', 'wf', ALL_KEYS, ['ac:main']);
    // No reading at all: state unknown, the fail-closed rule demotes opus.
    const out = await startLeg(w, 'R3-9211');
    expect(alternativeOf(out.advice, 'reviewer-2')).toBe('glm');
  });
});

describe('S-BTN-149: who steers', () => {
  it("under atoms_from admin a runner's readings form no atoms and move neither the route-choice state nor blocked; under any they do; an administrator's over an instrument's", async () => {
    // A second capacity resource, registered admin-only.
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'zai-capacity', scope: 'account', detail_schema: CAPACITY_BASE })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/instances', { name: 'zc:main', serves: ['zai-capacity'], repositories: ['docs'] })).status).toBe(200);
    const prog = structuredClone(program);
    (prog.entries as unknown[]).push(
      { id: 'meters-zai', fact: ['meters', 'key:zai', 'zai-capacity'] },
      { id: 'zai-near', head: ['zai_near', '$i'], body: [['refines', '$r', 'std:api-capacity@1'], ['usable', '$r', '$i'], ['int', '$i', 'remaining_permille', '$v'], { cmp: ['$v', '<', 500] }] },
    );
    (prog.route_choices as { id: string; alternatives: { id: string; needs: string[]; demote_when?: unknown[][] }[] }[]).push({
      id: 'reviewer-1',
      alternatives: [{ id: 'glm', needs: ['model:glm-5.3', 'key:zai'], demote_when: [[['zai_near', '$i']]] }],
    });
    const h0 = nextHead();
    await syncCall('/v1/sync/board', payload(h0.sha, h0.parent, board.states.A, {
      ontology: { builtin: 'baton@1', program: prog },
      registry: [course(3, 3, { route_choices: { implement: ['reviewer-1'] } })],
      state: { items: [item('R3-9401'), item('R3-9402')] },
      ready: ['R3-9401', 'R3-9402'],
    }));
    const w = await grantedWorker(owner, 'docs', 'w', ALL_KEYS, ['zc:main']);
    // The runner posts a measure and an unavailable state on zc:main — atoms_from is admin.
    expect((await w.call('/v1/runner/readings', { readings: [
      { instance: 'zc:main', kind: 'measure', valid_for: 3600, detail: { window_s: 300, remaining_permille: 100 } },
      { instance: 'zc:main', available: false, valid_for: 3600 },
    ] })).status).toBe(200);
    let out = await startLeg(w, 'R3-9401');
    expect(alternativeOf(out.advice, 'reviewer-1')).toBe('glm'); // no field atom, state unmoved: not demoted, not blocked
    // The fleet's resource block still hears the runner's reading (R-BTN-76 unchanged).
    expect((await rows<{ state: string }>("SELECT state FROM instance_states WHERE instance = 'zc:main'"))[0]?.state).toBe('unavailable');
    await w.call(`/v1/runner/claims/${out.claimId}/end`, { end_reason: 'released:requested' });
    // Re-registered any: the same readings now steer — the field atom forms (100‰ demotes) and
    // the runner's own unavailable state blocks the alternative it meters (S-BTN-149).
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'zai-capacity', scope: 'account', detail_schema: CAPACITY_BASE, atoms_from: 'any' })).status).toBe(200);
    await refresh();
    out = await startLeg(w, 'R3-9402');
    expect(alternativeOf(out.advice, 'reviewer-1')).toBeNull(); // blocked_alt: its own reading, now heard
    // A worker-scope resource's own instance steers its owner unconditionally (R-BTN-176: a
    // runner's reading for its own runner-scope instance is always permitted — the permission
    // atoms_from cannot close), where an account instance needed atoms_from any above: zai-local
    // stays atoms_from admin, the worker's own unavailable reading on it still blocks glm.
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'zai-local', scope: 'worker', detail_schema: { type: 'object' } })).status).toBe(200);
    const progLocal = structuredClone(prog);
    (progLocal.entries as unknown[]).push({ id: 'meters-zai-local', fact: ['meters', 'key:zai', 'zai-local'] });
    const wl = await grantedWorker(owner, 'docs', 'wl', ALL_KEYS, ['zc:main']);
    expect((await wl.call('/v1/runner/readings', { readings: [{ instance: `zai-local@worker:${wl.id}`, available: false, valid_for: 3600 }] })).status).toBe(200);
    const h1 = nextHead();
    await syncCall('/v1/sync/board', payload(h1.sha, h1.parent, board.states.A, {
      ontology: { builtin: 'baton@1', program: progLocal },
      registry: [course(3, 3, { route_choices: { implement: ['reviewer-1'] } })],
      state: { items: [item('R3-9404')] },
      ready: ['R3-9404'],
    }));
    const ownOut = await startLeg(wl, 'R3-9404');
    expect(alternativeOf(ownOut.advice, 'reviewer-1')).toBeNull(); // the own instance's unavailable reading blocks glm under atoms_from admin
    await wl.call(`/v1/runner/claims/${ownOut.claimId}/end`, { end_reason: 'released:requested' });
    // An administrator's reading over the runner's: the administrator speaks — available, 900‰.
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'zc:main', available: true, valid_for: 86400, detail: { window_s: 300, remaining_permille: 900 } }] })).status).toBe(200);
    await postBoard({ implement: ['reviewer-1'] }, ['R3-9403']);
    await refresh();
    out = await startLeg(w, 'R3-9403');
    const ranked = out.advice!.route_choices[0].ranked;
    expect(ranked.map((r) => r.alternative)).toEqual(['glm']);
    expect(ranked[0].demoted).toBe(false);
    await w.call(`/v1/runner/claims/${out.claimId}/end`, { end_reason: 'released:requested' });
  });
});

describe('S-BTN-150: atom shapes', () => {
  it('only a nested integer forms an atom, by its dotted path; a rule comparing a str value with < is refused', async () => {
    expect((await keyCall(admin, '/v1/admin/resources', { name: 'shapes', scope: 'account', detail_schema: { type: 'object', additionalProperties: false, properties: {
      num: { type: 'number' }, nul: { type: 'null' }, arr: { type: 'array', items: { type: 'integer' } }, f: { type: 'boolean' }, deep: { type: 'object', properties: { n: { type: 'integer' } }, additionalProperties: false },
    } } })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/instances', { name: 'sh:one', serves: ['shapes'], repositories: ['docs'] })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'sh:one', available: true, valid_for: 86400, detail: { num: 1.5, nul: null, arr: [1], f: false, deep: { n: 5 } } }] })).status).toBe(200);
    const prog = structuredClone(program);
    (prog.entries as unknown[]).push(
      { id: 'meters-shapes', fact: ['meters', 'key:zai', 'shapes'] },
      { id: 'saw-nested', head: ['saw_nested'], body: [['int', 'sh:one', 'deep.n', '$v']] },
      { id: 'saw-flat', head: ['saw_flat'], body: [['int', 'sh:one', 'num', '$v']] },
    );
    (prog.route_choices as { id: string; alternatives: { id: string; needs: string[]; demote_when?: unknown[][] }[] }[]).push({
      id: 'reviewer-1', alternatives: [{ id: 'glm', needs: ['model:glm-5.3', 'key:zai'], demote_when: [[['saw_nested']], [['saw_flat']]] }],
    });
    const h0 = nextHead();
    await syncCall('/v1/sync/board', payload(h0.sha, h0.parent, board.states.A, {
      ontology: { builtin: 'baton@1', program: prog },
      registry: [course(3, 3, { route_choices: { implement: ['reviewer-1'] } })],
      state: { items: [item('R3-9501')] },
      ready: ['R3-9501'],
    }));
    const w = await grantedWorker(owner, 'docs', 'w', ALL_KEYS, ['sh:one']);
    const out = await startLeg(w, 'R3-9501');
    expect(out.advice!.route_choices[0].ranked[0].demoted).toBe(true); // saw_nested fired; saw_flat could not
    // A rule comparing a string with <: refused at validation.
    const bad = structuredClone(prog);
    (bad.entries as unknown[]).push({ id: 'str-lt', head: ['bad_str'], body: [['str', 'sh:one', 'deep.n', '$v'], { cmp: ['$v', '<', 3] }] });
    const hBad = nextHead();
    const res = await syncCall('/v1/sync/board', payload(hBad.sha, hBad.parent, board.states.A, { ontology: { builtin: 'baton@1', program: bad } }));
    expect(res.status).toBe(200);
    expect((await rows<{ reason: string }>('SELECT reason FROM ontology_refusals'))[0].reason).toBe('program');
  });
});

describe('S-BTN-151: refinement', () => {
  it('a tightening schema registers with its chain, a widening and a non-std: base are refused, and a rule over refines serves both refining resources', async () => {
    const tight = await keyCall(admin, '/v1/admin/resources', { name: 'cap-tight', scope: 'account', detail_schema: { ...CAPACITY_BASE, properties: { window_s: { type: 'integer', minimum: 1 }, remaining_permille: { type: 'integer', minimum: 0, maximum: 900 }, resets_at_min: { type: 'integer', minimum: 0 } } } });
    expect(tight.status).toBe(200);
    const wide = await keyCall(admin, '/v1/admin/resources', { name: 'cap-wide', scope: 'account', detail_schema: { ...CAPACITY_BASE, properties: { window_s: { type: 'integer', minimum: 1 }, remaining_permille: { type: 'integer', minimum: 0, maximum: 1200 }, resets_at_min: { type: 'integer', minimum: 0 } } } });
    expect(wide.status).toBe(400);
    expect((wide.json as { message?: string }).message).toMatch(/refine/);
    const nonStd = await keyCall(admin, '/v1/admin/resources', { name: 'cap-other', scope: 'account', detail_schema: { ...CAPACITY_BASE, 'x-baton-base': 'roadmap-pr:schema@1' } });
    expect(nonStd.status).toBe(400);
    expect((nonStd.json as { message?: string }).message).toMatch(/std:/);
    // Both ac:main (the base itself) and cap-tight's instance serve the same rule: the worker
    // uses both, ct:one at 150‰ and ac:main at 900‰, and the rule over refines fires on the
    // tightening one alone (S-BTN-151's "the rule serves both refining resources").
    expect((await keyCall(admin, '/v1/admin/instances', { name: 'ct:one', serves: ['cap-tight'], repositories: ['docs'] })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [
      { instance: 'ct:one', available: true, valid_for: 86400, detail: { window_s: 300, remaining_permille: 150 } },
      { instance: 'ac:main', available: true, valid_for: 86400, detail: { window_s: 300, remaining_permille: 900 } },
    ] })).status).toBe(200);
    await postBoard({ implement: ['reviewer-2'] }, ['R3-9151']);
    const w = await grantedWorker(owner, 'docs', 'w', ALL_KEYS, ['ac:main', 'ct:one']);
    const served = await startLeg(w, 'R3-9151');
    expect(alternativeOf(served.advice, 'reviewer-2')).toBe('glm'); // near_limit fired on ct:one's 150‰ through the chain
    expect(served.advice!.route_choices[0].ranked.map((r) => r.alternative)).toEqual(['glm', 'opus']);
    expect(served.advice!.route_choices[0].ranked[1].demoted).toBe(true);
    await w.call(`/v1/runner/claims/${served.claimId}/end`, { end_reason: 'released:requested' });
    // And with ct:one back at 900‰: nothing fires, opus again — the same rule, both resources.
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'ct:one', available: true, valid_for: 86400, detail: { window_s: 300, remaining_permille: 900 } }] })).status).toBe(200);
    await postBoard({ implement: ['reviewer-2'] }, ['R3-9152']);
    const recovered = await startLeg(w, 'R3-9152');
    expect(alternativeOf(recovered.advice, 'reviewer-2')).toBe('opus');
    await w.call(`/v1/runner/claims/${recovered.claimId}/end`, { end_reason: 'released:requested' });
    void served;
    const stored = await rows<{ name: string; base_chain_json: string; atoms_from: string }>('SELECT name, base_chain_json, atoms_from FROM external_resources WHERE name IN (?, ?) ORDER BY name', 'anthropic-capacity', 'cap-tight');
    expect(stored).toEqual([
      { name: 'anthropic-capacity', base_chain_json: '["std:api-capacity@1"]', atoms_from: 'any' },
      { name: 'cap-tight', base_chain_json: '["std:api-capacity@1"]', atoms_from: 'admin' },
    ]);
  });
});

describe('S-BTN-152: strata and reserved names', () => {
  it('each refused program names its dependency path or the reserved predicate', async () => {
    const refused = structuredClone(program) as typeof program;
    (refused.entries as unknown[]).push({ id: 'derived-int', head: ['derived', 'capability:from-int'], body: [['int', '$i', 'p', '$v']] });
    let h1 = nextHead();
    let res = await syncCall('/v1/sync/board', payload(h1.sha, h1.parent, board.states.A, { ontology: { builtin: 'baton@1', program: refused } }));
    expect(res.status).toBe(200);
    let why = (await rows<{ detail: string }>('SELECT detail FROM ontology_refusals ORDER BY at DESC'))[0].detail;
    expect(why).toMatch(/depends on int/);

    for (const body of [[['now', 'epoch_min', '$v']], [['was_demoted', '$c', '$a']], [['route', '$c', '$a']]] as unknown[][]) {
      const p = structuredClone(program) as typeof program;
      (p.entries as unknown[]).push({ id: 'derived-x', head: ['derived', 'capability:x'], body });
      const h2 = nextHead();
      res = await syncCall('/v1/sync/board', payload(h2.sha, h2.parent, board.states.A, { ontology: { builtin: 'baton@1', program: p } }));
      expect((await rows<{ detail: string }>('SELECT detail FROM ontology_refusals ORDER BY at DESC'))[0].detail).toMatch(/depends on (now|was_demoted|route)|the (body literal|encoding)/);
    }

    const guardRoute = structuredClone(program) as typeof program;
    (guardRoute.route_choices as { alternatives: { demote_when?: unknown[][] }[] }[])[0].alternatives[0].demote_when = [[['route', '$c', '$a']]];
    const h3 = nextHead();
    res = await syncCall('/v1/sync/board', payload(h3.sha, h3.parent, board.states.A, { ontology: { builtin: 'baton@1', program: guardRoute } }));
    expect((await rows<{ detail: string }>('SELECT detail FROM ontology_refusals ORDER BY at DESC'))[0].detail).toMatch(/encoding/);

    const factAvailable = structuredClone(program) as typeof program;
    (factAvailable.entries as unknown[]).push({ id: 'fact-available', fact: ['available', 'c', 'a'] });
    const h4 = nextHead();
    res = await syncCall('/v1/sync/board', payload(h4.sha, h4.parent, board.states.A, { ontology: { builtin: 'baton@1', program: factAvailable } }));
    expect((await rows<{ detail: string }>('SELECT detail FROM ontology_refusals ORDER BY at DESC'))[0].detail).toMatch(/reserved/);

    const meters3 = structuredClone(program) as typeof program;
    (meters3.entries as unknown[]).push({ id: 'meters-3', fact: ['meters', 'key:zai', 'zai-capacity', 'extra'] });
    const h5 = nextHead();
    res = await syncCall('/v1/sync/board', payload(h5.sha, h5.parent, board.states.A, { ontology: { builtin: 'baton@1', program: meters3 } }));
    expect((await rows<{ detail: string }>('SELECT detail FROM ontology_refusals ORDER BY at DESC'))[0].detail).toMatch(/meters/);
  });
});

describe('S-BTN-153: delivery and overrides', () => {
  /** Start implement (route choices attached) and finish it into review, reporting `taken`. */
  async function runTicket(w: FleetWorker, id: string, taken?: unknown[]) {
    const claim = await w.call('/v1/runner/claim', { request_id: requestId(), ticket_id: `docs:${id}` });
    expect(claim.status).toBe(200);
    const claimId = claim.json.claim_id as number;
    const start = await w.call(`/v1/runner/claims/${claimId}/advance`, { leg: 'implement' });
    expect(start.status).toBe(200);
    const advice = start.json.advice as { route_choices: { choice: string; alternative: string | null; ranked: { alternative: string }[] }[] } | null;
    const finish = await w.call(`/v1/runner/claims/${claimId}/advance`, { reached: 'pr-open', leg: 'review', ...(taken === undefined ? {} : { taken }) });
    expect(finish.status).toBe(200);
    const legRow = (await rows<{ seq: number; leg: string; route_choices_json: string | null; taken_json: string | null }>('SELECT seq, leg, route_choices_json, taken_json FROM claim_legs WHERE claim_id = ? ORDER BY seq', claimId));
    await w.call(`/v1/runner/claims/${claimId}/end`, { end_reason: 'released:requested' });
    return { claimId, advice, legRow };
  }
  const overridden = () => rows<{ ticket_id: string; detail_json: string }>("SELECT ticket_id, detail_json FROM events WHERE kind = 'advice-overridden' ORDER BY seq");
  const takenInvalid = () => rows<{ detail_json: string }>("SELECT detail_json FROM events WHERE kind = 'taken-invalid' ORDER BY seq");

  it('the advice is delivered as identifiers and stored with the leg run; a dead key removes the holding and advises the next leg without it', async () => {
    // near_limit at 150‰: glm advised, opus demoted behind it.
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'ac:main', available: true, valid_for: 86400, detail: { window_s: 300, remaining_permille: 150 } }] })).status).toBe(200);
    await postBoard({ implement: ['reviewer-2'], review: ['reviewer-2'] }, ['R3-9601']);
    const w = await grantedWorker(owner, 'docs', 'w1', ALL_KEYS, ['ac:main']);
    const claim = await w.call('/v1/runner/claim', { request_id: requestId(), ticket_id: 'docs:R3-9601' });
    const claimId = claim.json.claim_id as number;
    const start = await w.call(`/v1/runner/claims/${claimId}/advance`, { leg: 'implement' });
    const advice = start.json.advice as { route_choices: { choice: string; alternative: string | null; ranked: { alternative: string }[] }[]; resolved_at: number };
    expect(advice.route_choices.map((r) => r.choice)).toEqual(['reviewer-2']);
    expect(advice.route_choices[0].alternative).toBe('glm');
    expect(advice.route_choices[0].ranked.map((r) => r.alternative)).toEqual(['glm', 'opus']);
    expect(typeof advice.resolved_at).toBe('number');
    // Identifiers only (G-BTN-161): no reading value ever appears in the advice.
    expect(JSON.stringify(advice)).not.toContain('remaining_permille');
    expect(JSON.stringify(advice)).not.toContain('150');
    const row = (await rows<{ route_choices_json: string }>('SELECT route_choices_json FROM claim_legs WHERE claim_id = ? AND seq = 1', claimId))[0];
    expect(JSON.parse(row.route_choices_json)).toEqual(advice.route_choices);
    // The leg found key:zai dead, took opus: the advance finishing implement reports it, the
    // same advance's review resolution runs without key:zai, and the override is recorded.
    const finish = await w.call(`/v1/runner/claims/${claimId}/advance`, { reached: 'pr-open', leg: 'review', taken: [{ choice: 'reviewer-2', alternative: 'opus', dead: ['key:zai'] }] });
    expect(finish.status).toBe(200);
    expect(await rows<{ capability: string }>('SELECT capability FROM worker_capabilities WHERE worker_id = ? AND capability = ?', w.id, 'key:zai')).toEqual([]);
    expect((await overridden()).map((e) => ({ ...JSON.parse(e.detail_json) }))).toEqual([{ choice: 'reviewer-2', advised: 'glm', taken: 'opus' }]);
    const takenRow = (await rows<{ taken_json: string }>('SELECT taken_json FROM claim_legs WHERE claim_id = ? AND seq = 1', claimId))[0];
    expect(JSON.parse(takenRow.taken_json!)).toEqual([{ choice: 'reviewer-2', alternative: 'opus', dead: ['key:zai'] }]);
    // The review leg this advance started was advised without key:zai: glm lacks, opus first.
    const reviewAdvice = (finish.json.advice as { route_choices: { choice: string; alternative: string | null }[] }).route_choices[0];
    expect(reviewAdvice.alternative).toBe('opus');
    await w.call(`/v1/runner/claims/${claimId}/end`, { end_reason: 'done', reached: 'reviewed' });
  });

  it('no report leaves taken_json null; the advised one records nothing; an unknown alternative is dropped and logged; an oversized file is dropped whole', async () => {
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'ac:main', available: true, valid_for: 86400, detail: { window_s: 300, remaining_permille: 900 } }] })).status).toBe(200);
    await postBoard({ implement: ['reviewer-2'] }, ['R3-9611', 'R3-9612', 'R3-9613', 'R3-9614']);
    const w = await grantedWorker(owner, 'docs', 'w2', ALL_KEYS, ['ac:main']);
    const none = await runTicket(w, 'R3-9611');
    expect(none.legRow[0].taken_json).toBeNull();
    expect(await overridden()).toEqual([]);
    const advised = await runTicket(w, 'R3-9612', [{ choice: 'reviewer-2', alternative: 'opus' }]);
    expect(JSON.parse(advised.legRow[0].taken_json!)).toEqual([{ choice: 'reviewer-2', alternative: 'opus' }]);
    expect(await overridden()).toEqual([]); // the advised one is not an override
    const unknown = await runTicket(w, 'R3-9613', [{ choice: 'reviewer-2', alternative: 'no-such' }]);
    expect(unknown.legRow[0].taken_json).toBeNull();
    expect((await takenInvalid()).length).toBe(1);
    // Over 4 KB of VALID entries — every dead holding a well-shaped capability — dropped whole
    // by the size bound alone (the runner drops the file first; the same bound holds here).
    const fat = Array.from({ length: 70 }, (_, i) => `key:${'k'.repeat(60)}${i}`);
    const oversized = await runTicket(w, 'R3-9614', [{ choice: 'reviewer-2', alternative: 'opus', dead: fat }]);
    expect(JSON.stringify([{ choice: 'reviewer-2', alternative: 'opus', dead: fat }]).length).toBeGreaterThan(4096);
    expect(oversized.legRow[0].taken_json).toBeNull(); // over 4 KB: dropped whole, the advance accepted
  });

  it('a leg without route choices reporting one is dropped and logged; a null resolution stores an alternative without an override', async () => {
    await postBoard({}, ['R3-9621']);
    const w = await grantedWorker(owner, 'docs', 'w3', ALL_KEYS, []);
    const bare = await runTicket(w, 'R3-9621', [{ choice: 'reviewer-2', alternative: 'opus' }]);
    expect(bare.legRow[0].taken_json).toBeNull();
    expect((await takenInvalid()).length).toBeGreaterThanOrEqual(1);

    await postBoard({ implement: ['codegen'] }, ['R3-9622']);
    const noKeys = await grantedWorker(owner, 'docs', 'w4', ['agent-venue'], []);
    const nullResolved = await runTicket(noKeys, 'R3-9622', [{ choice: 'codegen', alternative: 'deepinfra' }]);
    expect(nullResolved.advice!.route_choices[0].alternative).toBeNull();
    expect(JSON.parse(nullResolved.legRow[0].taken_json!)).toEqual([{ choice: 'codegen', alternative: 'deepinfra' }]);
    expect(await overridden()).toEqual([]); // stored, not an override
  });
});

describe('S-BTN-154: limits', () => {
  it('a route-choice evaluation crossing a test-lowered bound answers limit, raises baton.ontology-limit once, and the advance succeeds', async () => {
    await rows(`INSERT INTO baton_settings (key, value) VALUES ('ontology_test_bounds', ?)
                ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify({ route: { matches: 1 } }));
    try {
      await postBoard({ implement: ['codegen'] }, ['R3-9701']);
      const w = await grantedWorker(owner, 'docs', 'w', ALL_KEYS, ['ocg:go-plus', 'di:main']);
      const claim = await w.call('/v1/runner/claim', { request_id: requestId(), ticket_id: 'docs:R3-9701' });
      const claimId = claim.json.claim_id as number;
      const adv = await w.call(`/v1/runner/claims/${claimId}/advance`, { leg: 'implement' });
      expect(adv.status).toBe(200); // the advance succeeds
      const advice = adv.json.advice as { route_choices: { choice: string; alternative: string | null; ranked: unknown[]; reason?: string }[] };
      expect(advice.route_choices[0]).toMatchObject({ choice: 'codegen', alternative: null, ranked: [], reason: 'limit' });
      expect((await rows<{ reason: string }>('SELECT reason FROM ontology_refusals WHERE reason LIKE ?', 'ontology-limit%')).length).toBe(1);
      // No hysteresis rows: nothing was resolved.
      expect(await rows('SELECT * FROM route_last')).toEqual([]);
      await w.call(`/v1/runner/claims/${claimId}/end`, { end_reason: 'released:requested' });
    } finally {
      await rows(`DELETE FROM baton_settings WHERE key = 'ontology_test_bounds'`);
    }
  });
});

describe('G-BTN-161: advice never refuses, carries identifiers only, and an override is recorded', () => {
  it('a none-available resolution still starts the leg, and no reading text reaches the advice', async () => {
    await postBoard({ implement: ['codegen'] }, ['R3-9801']);
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'ocg:go-plus', available: false, valid_for: 86400 }, { instance: 'di:main', available: false, valid_for: 86400 }] })).status).toBe(200);
    const w = await grantedWorker(owner, 'docs', 'w', ALL_KEYS, ['ocg:go-plus', 'di:main']);
    const out = await startLeg(w, 'R3-9801');
    expect(alternativeOf(out.advice, 'codegen')).toBeNull(); // every provider blocked: advice, never a refusal
    expect(JSON.stringify(out.advice)).toMatch(/"reason":"none-available"/);
    expect(JSON.stringify(out.advice)).not.toMatch(/valid_for|remaining_permille|until/);
    await withCore(() => undefined);
  });
});

describe('R-BTN-174: an accepted program without a route choice drops its route_last rows', () => {
  it('dropping the codegen choice removes its hysteresis, keeping the rest', async () => {
    const w = await grantedWorker(owner, 'docs', 'w', ALL_KEYS, ['ocg:go-plus', 'di:main']);
    const out = await startLeg(w, 'R3-9101');
    expect(alternativeOf(out.advice, 'codegen')).toBe('deepinfra'); // T0 is in peak
    await w.call(`/v1/runner/claims/${out.claimId}/end`, { end_reason: 'released:requested' });
    expect((await rows<{ choice: string }>('SELECT choice FROM route_last')).map((r) => r.choice).sort()).toEqual(['codegen', 'codegen']);
    // A program that drops codegen (and the attachment with it): the choice's rows go.
    const dropped = structuredClone(program) as typeof program;
    dropped.route_choices = dropped.route_choices.filter((rc) => rc.id !== 'codegen');
    const h = nextHead();
    const res = await syncCall('/v1/sync/board', payload(h.sha, h.parent, board.states.A, {
      ontology: { builtin: 'baton@1', program: dropped },
      state: { items: [item('R3-9102')] },
      ready: ['R3-9102'],
    }));
    expect(res.status).toBe(200);
    expect(await rows('SELECT * FROM route_last')).toEqual([]);
  });
});
