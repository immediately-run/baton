// S-BTN-47's retries hold and grant ceiling, shared by its core and runner scenarios.
import { expect } from 'vitest';
import { Git, cutover, keyCall, setAdminKeys, setClock, withCore } from '../helpers';
import { grantedRunner } from './fleet';
import { makeKey } from './sshKeys';
import type { Workflow } from '../../src/core/ports';

export async function idleFixture() {
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

  const sent: Workflow[] = [];
  await withCore((c) => { c.dispatcher = async (wf) => { if (wf.kind === 'unblocked') sent.push(wf); return true; }; });
  const retry = () => keyCall(owner, '/v1/owner/docs/tickets/RETRY/resolve', { decision: 'baton:retries', answer: 'retry' });
  return { start, w, take, sent, retry };
}
