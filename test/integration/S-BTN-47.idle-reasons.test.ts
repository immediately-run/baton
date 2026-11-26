// B-244 extends S-BTN-47's retries queue and S-BTN-44's owner dispatch on both hosts.
import { expect, it } from 'vitest';
import { Git, course, cutover, keyCall, seedUnblockedDispatchIn, setAdminKeys, setClock, syncToken, tick, withCore } from '../helpers';
import { grantedRunner } from '../lib/fleet';
import { makeKey } from '../lib/sshKeys';
import { idleFixture } from '../lib/idleFixture';
import { noteIdle } from '../../src/core/idleReasons';
import type { Workflow } from '../../src/core/ports';

it('reports the grant and retry gates, raises one idle dispatch, then claims after retry', async () => {
  const { start, w, take, sent, retry } = await idleFixture();
  const refused = await take(2);
  const { code, message, detail } = refused.json;
  expect(refused.status).toBe(404);
  // A client from before B-244 can still consume just the old fields and status.
  expect({ code, message }).toEqual({ code: 'no-eligible-ticket', message: 'no ready ticket fits this runner' });
  expect(detail).toEqual({ repositories: [{ repository: 'docs', gates: [
    { gate: 'attempts-exhausted', count: 1, tickets: ['docs:RETRY'] },
    { gate: 'missing-capability', count: 1, tickets: ['docs:HIGH'], capabilities: ['human-operator'] },
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
  expect(sent).toEqual([{ kind: 'unblocked', repository: 'docs', tickets: [] }]);
  expect((await retry()).status).toBe(200);
  expect((await take(8)).json.ticket_id).toBe('docs:RETRY');
});

it('keeps the stale-skills refusal and queues the retries alert behind a full unblock batch', async () => {
  const start = Date.parse('2026-11-15T12:00:00Z');
  await setClock(start);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  const git = new Git().add('RETRY').add('STALE', { course_id: 'older' });
  git.registry.push(course(2, 2, { id: 'older' }));
  expect((await git.post()).status).toBe(200);
  await cutover(start);
  expect((await keyCall(owner, '/v1/owner/docs/settings', {
    retry: { backoff_ms: [60000], max_failed: 1 },
    unblocked_trigger: { kind: 'github-app', workflow: '.github/workflows/owner.yml' },
  }, 'PUT')).status).toBe(200);
  const w = await grantedRunner(owner, 'docs', 'mixed', ['agent-venue']);
  const courses = [{ repository: 'docs', course: 'roadmap-pr', version: 3 }, { repository: 'docs', course: 'older', version: 1 }];
  const take = (n: number) => w.call('/v1/runner/claim', { request_id: `mixed-idle-${n}` });
  const first = await take(1);
  expect(first.json.ticket_id).toBe('docs:RETRY');
  const path = `/v1/runner/claims/${first.json.claim_id}`;
  expect((await w.call(`${path}/advance`, { leg: 'implement' })).status).toBe(200);
  expect((await w.call(`${path}/end`, { end_reason: 'released:cannot-finish:transient' })).status).toBe(200);
  expect((await git.refresh()).status).toBe(200);
  expect((await w.beat({ courses })).status).toBe(200);
  const refusal = { status: 409, json: { code: 'stale-skills', rule: 9, detail: { repositories: [{ repository: 'docs', gates: [
    { gate: 'attempts-exhausted', count: 1, tickets: ['docs:RETRY'] },
    { gate: 'stale-skills', count: 1, tickets: ['docs:STALE'] },
  ] }] } } };
  expect(await take(2)).toMatchObject(refusal);
  expect(await w.call('/v1/runner/next', undefined, 'GET')).toMatchObject(refusal);

  const due = start + 30 * 60_000;
  await setClock(due);
  expect((await w.beat({ courses })).status).toBe(200);
  const batch = Array.from({ length: 101 }, (_, n) => ({ ticket: `docs:U-${n}`, cleared: [{ kind: 'ticket', ref: 'docs:DEP' }] }));
  const sent: Workflow[] = [];
  await withCore((c) => {
    c.dispatcher = async (wf) => { if (wf.kind === 'unblocked') sent.push(wf); return true; };
    seedUnblockedDispatchIn(c.store, { repository_id: 'docs', pending_json: JSON.stringify(batch), due_at: due });
  });
  expect(await take(3)).toMatchObject(refusal);
  await tick();
  expect(sent.map((wf) => wf.tickets)).toEqual([[...batch.slice(0, 100), { truncated: 1 }]]);
  await setClock(due + 30_000);
  await tick();
  expect(sent.map((wf) => wf.tickets)).toEqual([[...batch.slice(0, 100), { truncated: 1 }], []]);
  expect(await take(4)).toMatchObject(refusal);
  await setClock(due + 60_000);
  await tick();
  expect(sent).toHaveLength(2);
});

it('deduplicates each repository independently as the idle reasons change', async () => {
  const start = Date.parse('2026-11-15T12:00:00Z');
  await setClock(start);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  const w = await grantedRunner(owner, 'docs', 'two-repos', ['agent-venue']);
  await withCore((c) => {
    const notified: string[] = [];
    const notify = (repo: string) => { notified.push(repo); return true; };
    const poll = (after: number, ...repos: string[]) => c.store.transaction(() => noteIdle(c.store, w.id, start + after, 1000, {
      repositories: repos.map((repository) => ({ repository, gates: [{ gate: 'held', count: 1, tickets: [`${repository}:A`] }] })),
    }, notify));
    poll(0, 'docs');
    poll(1000, 'docs');
    poll(2000, 'other');
    poll(3000, 'docs', 'other');
    expect(notified).toEqual(['docs', 'other']);
  });
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
  expect((await new Git(privateToken).add('SECRET', { requires: ['human-operator'] }).post()).status).toBe(200);
  await cutover(start, 'private');
  const git = new Git();
  for (let n = 1; n <= 7; n++) git.add(`HIGH-${n}`, { requires: ['human-operator'] });
  expect((await git.post()).status).toBe(200);
  await cutover(start);
  const w = await grantedRunner(owner, 'docs', 'scoped', ['agent-venue']);
  expect((await w.beat()).status).toBe(200);
  const refusal = await w.call('/v1/runner/next', undefined, 'GET');
  expect(refusal.json.detail).toEqual({ repositories: [{ repository: 'docs', gates: [{ gate: 'missing-capability',
    count: 7, tickets: [1, 2, 3, 4, 5].map((n) => `docs:HIGH-${n}`), capabilities: ['human-operator'] }] }] });
});
