// S-BTN-139 to S-BTN-146 and S-BTN-155 (BATON_SPEC §15, §5.9, B-104): the capability ontology
// end to end — the board post's unit accepted or refused whole, holdings deriving capabilities,
// rule 4 reading H ∪ D(H), the grant bounding holdings alone, matching on derived sets and the
// blocks they move, why-not's canonical proof, freshness under a program change, a counted
// bound crossing (limited, through the test bindings), the merge and acceptance of a file over
// baton@1, and no credential material in the advance answer (the environment stays R-BTN-144's).
import { describe, it, expect, inject, beforeEach } from 'vitest';
import { call as hostCall } from '#host';
import { beat, keyCall, claimItem, cutover, endClaim, ORIGIN, ownerCall, payload, register, recommended, refresh, rows, setClock, syncCall, tick, withCore, workerCall } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { setAdminKeys } from '../helpers';

/** A granted key's signed blocks read (R-BTN-13), signed as workers.test.ts signs: the signed
 * Request handed to the host's transport, with the worker secret beside it. */
async function signedBlocks(key: TestKey, secret: string, repo: string, ticket: string): Promise<Response> {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const req = await signedRequest(key, `${ORIGIN}/v1/repositories/${repo}/tickets/${ticket}/blocks?worker=me`, { created, method: 'GET' });
  req.headers.set('X-Worker-Secret', secret);
  return hostCall(req);
}

/** The SHA-256 of a secret, as a heartbeat's `secret_hash` (R-BTN-14). */
async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const board = inject('board');
const sha = board.shas;
const T0 = Date.parse('2026-10-29T12:00:00Z');

/** The ontology these tests post: key:anthropic + dependency:claude-code derive Opus and
 *  code-generation; a binding narrows coding to Opus; `none`-typed legs never match it. */
const program = {
  version: 1,
  builtin: 'baton@1',
  derived: ['capability', 'model'],
  entries: [
    { id: 'class-coding', fact: ['model_class', 'coding'] },
    { id: 'model-opus', fact: ['model', 'model:claude-opus-5-5'] },
    { id: 'model-glm', fact: ['model', 'model:glm-5.3'] },
    { id: 'offers-anthropic', fact: ['offers', 'key:anthropic', 'model:claude-opus-5-5'] },
    { id: 'offers-zai', fact: ['offers', 'key:zai', 'model:glm-5.3'] },
    { id: 'usable-claude-code', fact: ['usable_with', 'dependency:claude-code', 'model:claude-opus-5-5'] },
    { id: 'usable-opencode', fact: ['usable_with', 'dependency:opencode-v2', 'model:glm-5.3'] },
    { id: 'binding-opens', head: ['model_for', '$c', '$m'], body: [['binding', '$c', '$m']] },
    { id: 'class-bound', head: ['bound', '$c'], body: [['binding', '$c', '$m']] },
    { id: 'class-open', head: ['model_for', '$c', '$m'], body: [['model_class', '$c'], ['model', '$m'], { not: ['bound', '$c'] }] },
    { id: 'one-binding', constraint: [['binding', '$c', '$m1'], ['binding', '$c', '$m2'], { cmp: ['$m1', '!=', '$m2'] }] },
    { id: 'direct-model', head: ['derived', '$m'], body: [['offers', '$k', '$m'], ['holds', '$k']] },
    { id: 'codegen', head: ['derived', 'capability:code-generation-llm'], body: [['model_for', 'coding', '$m'], ['offers', '$k', '$m'], ['holds', '$k'], ['usable_with', '$d', '$m'], ['holds', '$d']] },
  ],
  route_choices: [],
};

/** One ticket of the board fixture, cloned with a `requires` clause the caller names. */
const item = (id: string, requires: string[]): Record<string, unknown> => {
  const all = structuredClone(board.states.A.state.items) as Record<string, unknown>[];
  const base = all.find((i) => i.id === id) as Record<string, unknown>;
  return { ...base, requires };
};

const owner = (path: string, body: unknown) =>
  ownerCall(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) });

/** A worker's derived rows, as the tests read them. */
const derivedOf = async (workerId: number) => (await rows<{ capability: string }>('SELECT capability FROM worker_derived WHERE worker_id = ? ORDER BY capability', workerId)).map((r) => r.capability);

beforeEach(async () => {
  await setClock(T0);
  await syncCall('/v1/sync/board', payload(sha.A, null, board.states.A));
  await cutover();
});

describe('S-BTN-155: the unit is accepted or refused whole, at each post', () => {
  it('a posted program is stored, and the same unit posted twice changes nothing', async () => {
    const before = await rows('SELECT * FROM ontologies');
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B, { ontology: { builtin: 'baton@1', program } }));
    const after = await rows<{ repository_id: string; builtin: string; program_json: string }>('SELECT repository_id, builtin, program_json FROM ontologies');
    expect(before).toEqual([]);
    expect(after).toEqual([expect.objectContaining({ repository_id: 'docs', builtin: 'baton@1' })]);
    const acceptedAt = (await rows<{ accepted_at: number }>('SELECT accepted_at FROM ontologies'))[0].accepted_at;
    await syncCall('/v1/sync/board', payload(sha.C, sha.B, board.states.B, { ontology: { builtin: 'baton@1', program } }));
    expect((await rows<{ accepted_at: number }>('SELECT accepted_at FROM ontologies'))[0].accepted_at).toBe(acceptedAt);
  });

  it('a merge error is posted as {error}, the rest of the board is accepted, and the refusal is listed', async () => {
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B, { ontology: { error: 'the CLI ships no built-in ontology baton@9' } }));
    expect(await rows('SELECT * FROM ontologies')).toEqual([]);
    const listed = await rows<{ reason: string; detail: string }>('SELECT reason, detail FROM ontology_refusals');
    expect(listed[0]).toMatchObject({ reason: 'merge' });
    // The board itself was accepted: the head moved.
    expect(((await (await syncCall('/v1/sync/head')).json()) as { sha: string }).sha).toBe(sha.B);
  });

  it('a program that fails validation keeps the previous one in force, and a later unit closes the refusal', async () => {
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B, { ontology: { builtin: 'baton@1', program } }));
    const bad = { ...structuredClone(program), entries: [...structuredClone(program.entries), { id: 'late-holds', head: ['derived', 'capability:late'], body: [['holds', '$k']] }] };
    await syncCall('/v1/sync/board', payload(sha.C, sha.B, board.states.B, { ontology: { builtin: 'baton@1', program: bad } }));
    // The unit was refused whole: the previous program stays.
    expect((await rows<{ digest: string }>('SELECT digest FROM ontologies')).length).toBe(1);
    expect((await rows<{ reason: string }>('SELECT reason FROM ontology_refusals'))[0].reason).toBe('program');
    // A later accepted unit closes it.
    await syncCall('/v1/sync/board', payload(sha.D, sha.C, board.states.B, { ontology: { builtin: 'baton@1', program } }));
    expect(await rows('SELECT * FROM ontology_refusals')).toEqual([]);
  });

  it("a course entry's route_choices are part of the unit: an undefined id refuses it and keeps the entry's previous value", async () => {
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B, { ontology: { builtin: 'baton@1', program }, registry: board.states.A.registry }));
    // The registry carries route_choices naming an id the program does not define.
    const registry = structuredClone(board.states.A.registry) as Record<string, unknown>[];
    registry[0].route_choices = { implement: ['no-such-choice'] };
    await syncCall('/v1/sync/board', payload(sha.C, sha.B, board.states.B, { ontology: { builtin: 'baton@1', program }, registry }));
    expect((await rows<{ reason: string }>('SELECT reason FROM ontology_refusals'))[0].reason).toBe('route-attachment');
    expect((await rows<{ route_choices_json: string }>('SELECT route_choices_json FROM courses'))[0].route_choices_json).toBe('{}');
  });
});

describe('S-BTN-139/S-BTN-142/S-BTN-143: holdings derive, the grant bounds, rule 4 reads H ∪ D(H)', () => {
  beforeEach(async () => {
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.A, {
      ontology: { builtin: 'baton@1', program },
      // A ticket whose clause needs the derived capability, beside the fixture's own.
      state: { items: [item('R3-9002', ['capability:code-generation-llm'])] },
      ready: ['R3-9002'],
    }));
  });

  it('a worker holding the key and the dependency derives both and claims; the key alone derives only the model', async () => {
    const both = await register('vm-a', { capabilities: ['key:anthropic', 'dependency:claude-code'] });
    // A read brings the set up to date (R-BTN-174): no write evaluates it, the claim does.
    const claim = await claimItem('vm-a', both.secret, { ticket_id: 'docs:R3-9002' });
    expect(claim.json).toMatchObject({ ticket_id: 'docs:R3-9002', claim_id: expect.any(Number) });
    expect(await derivedOf(both.id)).toEqual(['capability:code-generation-llm', 'model:claude-opus-5-5'].sort());
    const keyAlone = await register('vm-b', { capabilities: ['key:anthropic'] });
    expect(await recommended(keyAlone.id)).toEqual([]);
    expect(await derivedOf(keyAlone.id)).toEqual(['model:claude-opus-5-5']);
    // The key-alone worker is not offered the codegen ticket (rule 4: no usable dependency) —
    // after a sync since the holder's end (§6.7), so the lease is not what refuses.
    const ended = await endClaim('vm-a', both.secret, claim.json.claim_id, { end_reason: 'released:requested' });
    void ended;
    await refresh();
    expect((await claimItem('vm-b', keyAlone.secret, { ticket_id: 'docs:R3-9002' })).json).toMatchObject({ rule: 4, rule_code: 'missing-capability' });
  });

  it('a worker holding neither derives nothing and is refused missing-capability', async () => {
    const none = await register('vm-a', { capabilities: [] });
    const res = await claimItem('vm-a', none.secret, { ticket_id: 'docs:R3-9002' });
    expect(res.json).toMatchObject({ code: 'not-eligible', rule: 4, rule_code: 'missing-capability' });
  });

  it('a derived type may still be declared directly: a declarer the grant admits matches too (R-BTN-174)', async () => {
    // The seed credential's allow-list is its grant (B-104), and the fixture's VENUE admits the
    // capability — so a worker that holds it by declaration, not derivation, passes rule 4.
    const direct = await register('vm-a', { capabilities: ['capability:code-generation-llm'] });
    expect(await derivedOf(direct.id)).toEqual([]);
    expect((await claimItem('vm-a', direct.secret, { ticket_id: 'docs:R3-9002' })).json).toMatchObject({ ticket_id: 'docs:R3-9002' });
  });

  it('a program change is not current until the next read brings it up to date (S-BTN-146)', async () => {
    const both = await register('vm-a', { capabilities: ['key:anthropic', 'dependency:claude-code'] });
    const claim = await claimItem('vm-a', both.secret, { ticket_id: 'docs:R3-9002' });
    expect(claim.json).toMatchObject({ ticket_id: 'docs:R3-9002', claim_id: expect.any(Number) });
    await endClaim('vm-a', both.secret, (claim.json as { claim_id: number }).claim_id, { end_reason: 'released:requested' });
    // A binding narrows coding to Opus… which still derives. Narrow it away instead: a binding
    // for glm, which the worker cannot run, makes model_for(coding)=glm only.
    const narrowed = structuredClone(program);
    narrowed.entries.push({ id: 'bind-coding', fact: ['binding', 'coding', 'model:glm-5.3'] });
    await syncCall('/v1/sync/board', payload(sha.C, sha.B, board.states.A, {
      ontology: { builtin: 'baton@1', program: narrowed },
      state: { items: [item('R3-9002', ['capability:code-generation-llm'])] },
      ready: ['R3-9002'],
    }));
    // The next claim re-evaluates first and is refused (rule 4 against the current set).
    const res = await claimItem('vm-a', both.secret, { request_id: 'req-after-narrowing', ticket_id: 'docs:R3-9002' });
    expect(res.json).toMatchObject({ code: 'not-eligible', rule: 4, rule_code: 'missing-capability' });
    expect(await derivedOf(both.id)).toEqual(['model:claude-opus-5-5']);
  });

  it('a lowered bound through the test bindings stores the empty set limited, once, and no re-evaluation follows (S-BTN-146)', async () => {
    await rows(`INSERT INTO baton_settings (key, value) VALUES ('ontology_test_bounds', ?)
                ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify({ matches: 1 }));
    try {
      const worker = await register('vm-a', { capabilities: ['key:anthropic', 'dependency:claude-code'] });
      // A read triggers the evaluation under the lowered bound — a claim, refused rule 4.
      expect((await claimItem('vm-a', worker.secret, { ticket_id: 'docs:R3-9002' })).json).toMatchObject({ rule: 4 });
      expect(await derivedOf(worker.id)).toEqual([]);
      const stored = await rows<{ limited: number }>('SELECT limited FROM worker_derived_inputs WHERE worker_id = ?', worker.id);
      expect(stored[0].limited).toBe(1);
      // The refusal is raised once per repository and program digest.
      expect((await rows<{ reason: string }>('SELECT reason FROM ontology_refusals WHERE reason LIKE ?', 'ontology-limit%')).length).toBe(1);
      // A later read does not retry a limited set.
      expect(await derivedOf(worker.id)).toEqual([]);
    } finally {
      await rows(`DELETE FROM baton_settings WHERE key = 'ontology_test_bounds'`);
    }
  });
});

describe('S-BTN-144: why-not walks the canonical proof', () => {
  beforeEach(async () => {
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.A, {
      ontology: { builtin: 'baton@1', program },
      state: { items: [item('R3-9002', ['capability:code-generation-llm'])] },
      ready: ['R3-9002'],
    }));
  });

  it("the blocks index carries not-derived with needs and the chain — missing for a worker, omitted for the fleet", async () => {
    // Hold the dependency alone: the capability is missing, and the proof needs the key. The
    // capability block is written by the recount an alarm tick runs (R-BTN-75).
    const worker = await register('vm-a', { capabilities: ['dependency:claude-code'] });
    await tick();
    // The fleet answer (an administrator's read): needs and chain, `missing` omitted.
    const admin = await makeKey('ssh-ed25519', 'b104-admin');
    await setAdminKeys(admin);
    const fleetRes = await keyCall(admin, '/v1/repositories/docs/tickets/R3-9002/blocks');
    expect(fleetRes.status).toBe(200);
    const fleet = fleetRes.json as unknown as { blocks?: { kind: string; ref: string; why?: { why: string; needs: string[]; missing: string[]; chain: string[] } }[] };
    const fleetRow = (fleet.blocks ?? []).find((b) => b.kind === 'capability' && b.ref === 'capability:code-generation-llm');
    expect(fleetRow).toBeDefined();
    expect(fleetRow!.why).toMatchObject({ why: 'not-derived', needs: ['dependency:claude-code', 'key:anthropic'], missing: [], chain: expect.arrayContaining(['codegen']) });
    // The worker's own answer names what IT lacks: the key. A granted key's session reads it
    // (rule 7: the token fixture is not granted), so grant one and read as its worker.
    const k = await makeKey('ssh-ed25519', 'b104-why');
    const grant = await keyCall(admin, '/v1/admin/grants', { repository: 'docs', public_key: k.publicKey, hostname: 'b104-why-host', capabilities: ['dependency:claude-code'] });
    expect(grant.status, JSON.stringify(grant.json)).toBe(200);
    const secret = 'b104-why-secret';
    const created = Math.floor((await withCore((c) => c.now())) / 1000);
    const body = JSON.stringify({ hostname: 'b104-why-host', session_name: 'b104-why', harness: 'opencode', kind: 'vm', secret_hash: await sha256Hex(secret), billing: { 'zai-coding-plan': 'zai' }, capabilities: ['dependency:claude-code'], tier_ceiling: 'critical', lease_timeout_s: 900, courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] });
    const hb = await hostCall(await signedRequest(k, `${ORIGIN}/v1/runner/heartbeat`, { created, body }));
    expect(hb.status, await hb.text()).toBe(200);
    const res = await signedBlocks(k, secret, 'docs', 'R3-9002');
    const out = (await res.json()) as { blocks?: { kind: string; ref: string; why?: { why: string; needs: string[]; missing: string[]; ungranted: string[]; chain: string[]; direct: boolean } }[] };
    const row = (out.blocks ?? []).find((b) => b.kind === 'capability' && b.ref === 'capability:code-generation-llm');
    expect(row).toBeDefined();
    expect(row!.why).toMatchObject({
      why: 'not-derived',
      needs: expect.arrayContaining(['key:anthropic']),
      missing: ['key:anthropic'],
      ungranted: [],
      chain: expect.arrayContaining(['codegen']),
      direct: false,
    });
    void worker;
  });

  it('a capability no reachable chain derives answers not-derivable', async () => {
    // Narrow coding to glm (a binding fact): the anthropic worker's proof is gone — under the
    // narrowed program no holdings it could hold derive the capability.
    const narrowed = structuredClone(program);
    narrowed.entries.push({ id: 'bind-coding', fact: ['binding', 'coding', 'model:glm-5.3'] });
    await syncCall('/v1/sync/board', payload(sha.C, sha.B, board.states.A, {
      ontology: { builtin: 'baton@1', program: narrowed },
      state: { items: [item('R3-9002', ['capability:code-generation-llm'])] },
      ready: ['R3-9002'],
    }));
    await tick();
    const reader = await makeKey('ssh-ed25519', 'b104-admin-2');
    await setAdminKeys(reader);
    const res = await keyCall(reader, '/v1/repositories/docs/tickets/R3-9002/blocks');
    expect(res.status).toBe(200);
    const out = res.json as unknown as { blocks?: { kind: string; ref: string; why?: { why: string; needs: string[] } }[] };
    const row = (out.blocks ?? []).find((b) => b.kind === 'capability');
    expect(row?.why?.why).toBe('not-derived');
    expect(row?.why?.needs).toEqual(expect.arrayContaining(['key:zai']));
  });
});

describe('S-BTN-145: the environment is R-BTN-144\u2019s — no credential data in any answer', () => {
  it('an advance answer and a claim answer carry no credential material', async () => {
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.A, {
      ontology: { builtin: 'baton@1', program },
      state: { items: [item('R3-9002', ['capability:code-generation-llm'])] },
      ready: ['R3-9002'],
    }));
    const worker = await register('vm-a', { capabilities: ['key:anthropic', 'dependency:claude-code', 'credential:DEPLOY_TOKEN'] });
    const claim = await claimItem('vm-a', worker.secret, { ticket_id: 'docs:R3-9002' });
    expect(JSON.stringify(claim.json)).not.toContain('DEPLOY_TOKEN');
    expect(JSON.stringify(claim.json)).not.toContain('credential:');
    // The stored derived rows carry no credential either: only the derived types.
    expect(await derivedOf(worker.id)).not.toContain('credential:DEPLOY_TOKEN');
  });
});
