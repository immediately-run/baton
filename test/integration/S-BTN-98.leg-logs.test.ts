import { beforeEach, describe, expect, it } from 'vitest';
import { advance, beat, claimItem, cutover, endClaim, Git, HOST, keyCall, ORIGIN, register, rows, runnerCall, setAdminKeys, setClock } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

let owner: TestKey;
let other: TestKey;
let admin: TestKey;
const settings = '/v1/owner/docs/settings';
const runs = '/v1/repositories/docs/tickets/T-1/legs/implement/runs';
const release = '/v1/owner/docs/tickets/T-1/release';
const now = Date.parse('2026-11-09T12:00:00Z');

beforeEach(async () => {
  await setClock(now);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  other = await makeKey('ssh-ed25519', 'other owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'other', github: 'example/other', forge: 'github', remote: 'ssh://git@github.com/example/other', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [other.publicKey] })).status).toBe(200);
  expect((await new Git().add('T-1').add('T-2').post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-98 and S-BTN-99: run locations and release', () => {
  it('validates an owner destination before writing, with file roots only on local', async () => {
    for (const root of ['https://storage.test/bucket', 's3://bucket/../escape', 'gs://bucket/key?token=x', 'file://host/root']) {
      expect((await keyCall(owner, settings, { leg_log_root: root }, 'PUT')).json).toMatchObject({ code: 'invalid-params' });
    }
    const file = await keyCall(owner, settings, { leg_log_root: 'file:///tmp/logs' }, 'PUT');
    expect(file.status === 200).toBe(String(HOST) === 'local');
  });

  it('assigns a create-only archive location per run and authorizes reads and stop', async () => {
    expect((await keyCall(owner, settings, { leg_log_root: 's3://test-bucket/team/' }, 'PUT')).status).toBe(200);
    const runner = await register('vm-a');
    const claim = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:T-1', request_id: 'log-claim' });
    expect(claim.status).toBe(200);
    expect(claim.json).not.toHaveProperty('leg_log'); // no run exists yet
    const started = await advance('vm-a', runner.secret, claim.json.claim_id, { leg: 'implement' });
    expect(started.status).toBe(200);
    const dir = `s3://test-bucket/team/${encodeURIComponent(new URL(ORIGIN).host)}/docs/T-1/implement/${started.json.run_id}/`;
    expect(started.json.leg_log).toEqual({ dir });
    expect((await keyCall(owner, runs)).json).toMatchObject({ runs: [{ log_dir: dir, transcripts: [] }] });
    expect((await keyCall(admin, runs)).status).toBe(200);
    expect((await keyCall(other, runs)).status).toBe(403);
    expect((await keyCall(owner, '/v1/ticket-matches/T-1')).json).toEqual({ matches: ['docs:T-1'] });
    expect((await keyCall(other, '/v1/ticket-matches/T-1')).json).toEqual({ matches: [] });
    expect((await keyCall(other, release, {})).status).toBe(403);
    const stop = await keyCall(owner, release, {});
    expect(stop.status).toBe(200);
    expect((await beat('vm-a', runner.secret)).json.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: stop.json.id, kind: 'release', payload: { ticket_id: 'docs:T-1', reason: 'requested' } }),
    ]));
    expect((await keyCall(owner, settings, { leg_log_root: null }, 'PUT')).status).toBe(200);
    const second = await register('vm-b');
    const next = await claimItem('vm-b', second.secret, { ticket_id: 'docs:T-2' });
    const off = await advance('vm-b', second.secret, next.json.claim_id, { leg: 'implement' });
    expect(off.status).toBe(200);
    expect(off.json).not.toHaveProperty('leg_log');
    expect((await keyCall(owner, runs)).json).toMatchObject({ runs: [{ log_dir: dir }] });
  });

  it('keeps the first run transcript when another leg starts and records late archive failures', async () => {
    await keyCall(owner, settings, { leg_log_root: 's3://test-bucket/team/' }, 'PUT');
    const { secret } = await register('vm-a');
    const { json: { claim_id } } = await claimItem('vm-a', secret, { ticket_id: 'docs:T-1' });
    const first = await advance('vm-a', secret, claim_id, { leg: 'implement' });
    expect(first.status).toBe(200);
    const repo = 'immediately-run/claude-sessions';
    const pointer = (path: string) => ({ repo, path });
    expect((await beat('vm-a', secret, { transcripts: [pointer('cc/first.jsonl')] })).status).toBe(200);
    await setClock(now + 100);
    const second = await advance('vm-a', secret, claim_id, { reached: 'pr-open', leg: 'review' });
    expect(second.status).toBe(200);
    expect((await beat('vm-a', secret, { transcripts: [pointer('cc/first.jsonl'), pointer('cc/second.jsonl')] })).status).toBe(200);
    expect((await keyCall(owner, runs)).json).toMatchObject({ runs: [{ transcripts: [pointer('cc/first.jsonl')] }] });
    expect((await keyCall(owner, runs.replace('/implement/', '/review/'))).json).toMatchObject({ runs: [{ transcripts: [pointer('cc/second.jsonl')] }] });
    expect((await endClaim('vm-a', secret, claim_id, { end_reason: 'released:requested' })).status).toBe(200);
    const report = { claim_id, source: 'hook', kind: 'other', label: 'leg-log-write-failed', started_at: now + 100, ended_at: now + 100, outcome: 'failed' };
    const valid = `${first.json.run_id}:log`;
    const invalid = 'missing-run:log';
    const response = await runnerCall('/v1/runner/activities', { secret, cred: 'vm-a', body: { activities: [
      { ...report, id: valid }, { ...report, id: invalid },
    ] } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ refused: [{ id: invalid, code: 'claim-ended' }] });
    expect(await rows('SELECT id, label, outcome FROM activities WHERE claim_id = ?', claim_id)).toEqual([
      { id: valid, label: 'leg-log-write-failed', outcome: 'failed' },
    ]);
  });
});
