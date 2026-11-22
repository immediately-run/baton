// B-244 extends S-BTN-47's retries queue and S-BTN-44's owner dispatch on both hosts.
import { expect, it } from 'vitest';
import { Git, cutover, keyCall, setAdminKeys, setClock, syncToken, tick, withCore } from '../helpers';
import { grantedRunner } from '../lib/fleet';
import { makeKey } from '../lib/sshKeys';

it('reports the grant and retry gates, raises one idle dispatch, then claims after retry', async () => {
  const start = Date.parse('2026-11-15T12:00:00Z');
  await setClock(start);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  const git = new Git().add('RETRY', { tier: 'judgement' }).add('HIGH', { tier: 'critical' });
  expect((await git.post()).status).toBe(200);
  await cutover(start);
  expect((await keyCall(owner, '/v1/owner/docs/settings', {
    retry: { backoff_ms: [60000], max_failed: 1 },
    unblocked_trigger: { kind: 'github-app', workflow: '.github/workflows/owner.yml' },
  }, 'PUT')).status).toBe(200);
  const w = await grantedRunner(owner, 'docs', 'idle', ['agent-venue']);
  expect((await keyCall(owner, '/v1/owner/docs/grants', {
    public_key: w.key.publicKey, hostname: w.hostname, capabilities: ['agent-venue'], max_tier: 'judgement',
  })).status).toBe(200);
  const take = (n: number) => w.call('/v1/runner/claim', { request_id: `idle-test-${n}` });
  const first = await take(1);
  expect(first.json.ticket_id).toBe('docs:RETRY');
  const path = `/v1/runner/claims/${first.json.claim_id}`;
  expect((await w.call(`${path}/advance`, { leg: 'implement' })).status).toBe(200);
  expect((await w.call(`${path}/end`, { end_reason: 'released:cannot-finish:transient' })).status).toBe(200);
  expect((await git.refresh()).status).toBe(200);

  const sent: unknown[] = [];
  await withCore((c) => { c.dispatcher = async (wf) => { if (wf.kind === 'unblocked') sent.push(...(wf.tickets ?? [])); return true; }; });
  const refused = await take(2);
  const { code, message, detail } = refused.json;
  expect(refused.status).toBe(404);
  // A client from before B-244 can still consume just the old fields and status.
  expect({ code, message }).toEqual({ code: 'no-eligible-ticket', message: 'no ready ticket fits this runner' });
  expect(detail).toEqual({ repositories: [{ repository: 'docs', gates: [
    { gate: 'attempts-exhausted', count: 1, tickets: ['docs:RETRY'] },
    { gate: 'grant-max-tier', limit: 'judgement', count: 1, tickets: ['docs:HIGH'] },
  ] }] });
  expect((await w.call('/v1/runner/next', undefined, 'GET')).json.detail).toEqual(detail);
  expect((await take(3)).json.detail).toEqual(detail);
  expect(sent).toEqual([]);
  for (const [i, minutes] of [29, 30, 31].entries()) {
    await setClock(start + minutes * 60_000);
    expect((await w.beat()).status).toBe(200);
    expect((await take(4 + i)).json.detail).toEqual(detail);
    await tick();
    expect(sent).toHaveLength(minutes < 30 ? 0 : 1);
  }
  expect(sent).toEqual([{ kind: 'runner-idle', runner_id: w.id, idle_since: start, gates: detail.repositories[0].gates }]);
  expect((await keyCall(owner, '/v1/owner/docs/tickets/RETRY/resolve', { decision: 'baton:retries', answer: 'retry' })).status).toBe(200);
  expect((await take(8)).json.ticket_id).toBe('docs:RETRY');
});

it('counts only granted repositories and caps ticket samples independently of the count', async () => {
  const start = Date.parse('2026-11-15T12:00:00Z');
  await setClock(start);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  await withCore((c) => c.registry.register({ id: 'private', github: 'immediately-run/private', default_branch: 'main', weight: 10,
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml' }));
  const privateToken = await syncToken({ repository: 'immediately-run/private', ref: 'refs/heads/main',
    job_workflow_ref: 'immediately-run/private/.github/workflows/baton-sync.yml@refs/heads/main' });
  expect((await new Git(privateToken).add('SECRET', { tier: 'critical' }).post()).status).toBe(200);
  await cutover(start, 'private');
  const git = new Git();
  for (let n = 1; n <= 7; n++) git.add(`HIGH-${n}`, { tier: 'critical' });
  expect((await git.post()).status).toBe(200);
  await cutover(start);
  const w = await grantedRunner(owner, 'docs', 'scoped', ['agent-venue']);
  expect((await w.beat({ tier_ceiling: 'judgement' })).status).toBe(200);
  const refusal = await w.call('/v1/runner/next', undefined, 'GET');
  expect(refusal.json.detail).toEqual({ repositories: [{ repository: 'docs', gates: [{ gate: 'declared-tier-ceiling',
    limit: 'judgement', count: 7, tickets: [1, 2, 3, 4, 5].map((n) => `docs:HIGH-${n}`) }] }] });
});
