// S-BTN-48, both hosts: the core resolves and stores envelopes, not artifact bytes.
import { beforeEach, describe, expect, it } from 'vitest';
import { SYNC_CLAIMS, advance, claimItem, course, cutover, endClaim, Git, placed, register, rows, setClock } from '../helpers';

const schema = 'std:git.commit@1';
const sha = 'a'.repeat(40);
const uri = `git:${SYNC_CLAIMS.repository}@${sha}:plan.json`;
const definition = {
  start: 'filed', start_leg: 'plan', end: ['done'], stations: { filed: {}, planned: {}, done: {} },
  legs: {
    plan: { from: ['filed'], to: 'planned', version: 2, outputs: { plan: { schema } } },
    apply: { from: ['planned'], to: 'done', inputs: { plan: { from: 'plan.plan' } } },
  },
};
let git: Git;

beforeEach(async () => {
  await setClock(Date.parse('2026-11-13T12:00:00Z'));
  git = new Git();
  git.registry = [course(3, 3, { course: definition })];
  git.add('T-1', {}, placed('filed', [], [['plan', 'ready']]));
  git.add('T-2', {}, placed('planned', [['plan', 'planned']], [['apply', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-48 core contracts', () => {
  it('stores input-missing before offering the consumer', async () => {
    expect(await rows("SELECT state, waiting_on FROM ticket_next_legs WHERE ticket_id = 'docs:T-2'"))
      .toEqual([{ state: 'waiting', waiting_on: 'input-missing' }]);
    const { secret } = await register('vm-a');
    expect((await claimItem('vm-a', secret, { ticket_id: 'docs:T-2' })).status).toBe(409);
    expect(await rows("SELECT json_extract(detail_json, '$.type') AS type FROM events WHERE kind = 'condition' AND ticket_id = 'docs:T-2'"))
      .toEqual([{ type: 'baton.input-missing' }]);
    expect(await rows("SELECT type, disposition, outcome FROM conditions WHERE ticket_id = 'docs:T-2'"))
      .toEqual([{ type: 'baton.input-missing', disposition: 'notify', outcome: 'open' }]);
    git.add('T-2', {}, placed('filed', [], [['plan', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect(await rows("SELECT outcome, closed_how FROM conditions WHERE ticket_id = 'docs:T-2'"))
      .toEqual([{ outcome: 'closed', closed_how: 'cause-ended' }]);
  });

  it('cannot invent a producer; checks reach and atomically resolves the holder output', async () => {
    const { secret } = await register('vm-a');
    const offered = (await claimItem('vm-a', secret, { ticket_id: 'docs:T-1' })).json;
    const claim = offered.claim_id;
    expect((await advance('vm-a', secret, claim, { leg: 'plan' })).status).toBe(200);
    const send = (pointer: string) => advance('vm-a', secret, claim, { leg: 'apply', reached: 'planned', evidence: sha, outputs: [{ name: 'plan', schema, uri: pointer }] });
    expect((await send(uri.replace(SYNC_CLAIMS.repository, 'other/repo'))).json).toMatchObject({ rule_code: 'output-invalid' });
    expect(await rows('SELECT * FROM leg_outputs')).toEqual([]);
    expect((await send(uri)).json).toMatchObject({ ok: true, inputs: [{ name: 'plan', schema, uri, from_leg: 'plan', from_run: 1, leg_version: 2 }] });
    expect(await rows('SELECT uri, value_json FROM leg_outputs')).toEqual([{ uri, value_json: null }]);
    expect(await rows("SELECT kind FROM ticket_history WHERE kind IN ('inputs','outputs') ORDER BY id")).toEqual([{ kind: 'outputs' }, { kind: 'inputs' }]);
    expect((await endClaim('vm-a', secret, claim, { end_reason: 'released:cannot-finish:contract-input', detail: 'input plan failed std:git.commit@1 from plan version 2' })).status).toBe(200);
    expect(await rows('SELECT failed_attempt FROM claims')).toEqual([{ failed_attempt: 0 }]);
    expect(await rows('SELECT hold_reason FROM ticket_overrides')).toEqual([{ hold_reason: 'non-retryable:contract-input' }]);
    expect(await rows('SELECT decision_id, question FROM ticket_decisions')).toEqual([{ decision_id: 'baton.contract', question: 'input plan failed std:git.commit@1 from plan version 2' }]);
    const attest = (nonce: string) => git.post({ attestations: [{ type: 'std:git.output@1', ticket: 'T-1', ref: sha,
      value: { claim_nonce: nonce, leg: 'plan', outputs: [{ name: 'plan', schema, uri }] } }] });
    expect((await attest('foreign')).status).toBe(200);
    expect(await rows('SELECT confirmed FROM leg_outputs')).toEqual([{ confirmed: 0 }]);
    expect((await attest(offered.nonce)).status).toBe(200);
    expect(await rows('SELECT confirmed FROM leg_outputs')).toEqual([{ confirmed: 1 }]);
  });

  it('recovers output for an exact abandoned run and reports a queued version mismatch', async () => {
    const { secret } = await register('vm-a');
    const offered = (await claimItem('vm-a', secret, { ticket_id: 'docs:T-1' })).json;
    const started = (await advance('vm-a', secret, offered.claim_id, { leg: 'plan' })).json;
    expect(started.run_id).toBeTruthy();
    expect((await endClaim('vm-a', secret, offered.claim_id, { end_reason: 'released:requested' })).status).toBe(200);
    const attest = (nonce: string) => git.post({ attestations: [{ type: 'std:git.output@1', ticket: 'T-1', ref: sha,
      value: { claim_nonce: nonce, run_id: started.run_id, leg: 'plan', outputs: [{ name: 'plan', schema, uri }] } }] });
    expect((await attest('foreign')).status).toBe(200);
    expect(await rows('SELECT * FROM leg_outputs')).toEqual([]);
    expect((await attest(offered.nonce)).status).toBe(200);
    expect(await rows('SELECT source, confirmed, leg_version FROM leg_outputs')).toEqual([{ source: 'sync', confirmed: 1, leg_version: 2 }]);
    const newer = structuredClone(definition);
    newer.legs.plan.version = 3;
    git.registry = [course(4, 3, { course: newer })];
    git.add('T-1', {}, placed('planned', [['plan', 'planned']], [['apply', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect(await rows("SELECT waiting_on FROM ticket_next_legs WHERE ticket_id = 'docs:T-1' AND leg = 'apply'"))
      .toEqual([{ waiting_on: 'input-version' }]);
  });

  it('keeps the executing snapshot contract when the registry changes after offer', async () => {
    const { secret } = await register('vm-a');
    const offered = (await claimItem('vm-a', secret, { ticket_id: 'docs:T-1' })).json;
    const newer = structuredClone(definition);
    newer.legs.plan.version = 3;
    newer.legs.plan.outputs.plan.schema = 'std:url@1';
    git.registry = [course(4, 3, { course: newer })];
    expect((await git.post()).status).toBe(200);
    expect((await advance('vm-a', secret, offered.claim_id, { leg: 'plan' })).status).toBe(200);
    const next = await advance('vm-a', secret, offered.claim_id, { leg: 'apply', reached: 'planned', outputs: [{ name: 'plan', schema, uri }] });
    expect(next.json).toMatchObject({ ok: true, inputs: [{ schema, leg_version: 2, course_version: 3 }] });
  });

  it('validates and resolves the pinned producer after its routing name changes', async () => {
    const { secret } = await register('vm-a');
    const offered = (await claimItem('vm-a', secret, { ticket_id: 'docs:T-1' })).json;
    const newer = { ...definition, start_leg: 'draft', legs: {
      draft: { ...definition.legs.plan, renamed_from: ['plan'] },
      apply: { ...definition.legs.apply, inputs: { plan: { from: 'draft.plan' } } },
    } };
    git.registry = [course(4, 3, { course: newer })];
    expect((await git.post()).status).toBe(200);
    expect((await advance('vm-a', secret, offered.claim_id, { leg: 'plan' })).status).toBe(200);
    const next = (outputs: unknown[]) => advance('vm-a', secret, offered.claim_id, { leg: 'apply', reached: 'planned', outputs });
    expect((await next([])).json).toMatchObject({ rule_code: 'output-invalid' });
    expect((await next([{ name: 'plan', schema, uri }])).json).toMatchObject({ ok: true, inputs: [{ from_leg: 'plan', leg_version: 2 }] });
    expect(await rows("SELECT leg, contract_leg FROM claim_legs WHERE seq = 1")).toEqual([{ leg: 'draft', contract_leg: 'plan' }]);
  });

  it('queues a person-leg successor as waiting on an incompatible answer version', async () => {
    git.registry = [course(4, 3, { course: { ...definition, legs: {
      plan: { from: ['filed'], to: 'planned', kind: 'person', asks: 'owner', version: 2 },
      apply: { ...definition.legs.apply, inputs: { decision: { from: 'plan.answer', accepts: [1] } } },
    } } })];
    git.add('T-1', { question: { id: 'q-1', options: [{ id: 'go', reached: 'planned' }] } }, placed('filed', [], [['plan', 'ready']]));
    expect((await git.post({ attestations: [{ type: 'std:decision@1', ticket: 'T-1', ref: sha,
      value: { id: 'q-1', leg: 'plan', option: 'go', reached: 'planned' } }] })).status).toBe(200);
    expect(await rows("SELECT leg, waiting_on FROM ticket_next_legs WHERE ticket_id = 'docs:T-1'")).toEqual([{ leg: 'apply', waiting_on: 'input-version' }]);
    expect(await rows("SELECT type, outcome FROM conditions WHERE ticket_id = 'docs:T-1'")).toEqual([{ type: 'baton.input-version', outcome: 'open' }]);
  });
});
