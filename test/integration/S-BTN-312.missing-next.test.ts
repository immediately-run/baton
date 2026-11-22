import { describe, expect, it } from 'vitest';
import { Git, cutover, keyCall, placed, rows, setAdminKeys, setClock } from '../helpers';
import { grantedRunner, signed } from '../lib/fleet';
import { makeKey } from '../lib/sshKeys';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const TYPE = 'baton.missing-next';
const path: [string, string][] = [['implement', 'pr-open']];

describe('S-BTN-312 a board post missing a queued leg', () => {
  it('keeps the board, reports only the stuck tickets and settles the condition on later posts', async () => {
    await setClock(NOW);
    const admin = await makeKey('ssh-ed25519', 'admin');
    const owner = await makeKey('ssh-ed25519', 'owner');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
    const missing = placed('pr-open', path, [['review', 'ready']], { next_leg: null });
    const fixed = placed('pr-open', path, [['review', 'ready']]);
    const end = placed('merged', [...path, ['review', 'reviewed'], ['merge', 'merged']], []);
    const git = new Git()
      .add('STUCK', {}, missing)
      .add('READY')
      .add('END', {}, end);

    const needsYou = async () => {
      const read = await signed(owner, '/v1/repositories/docs/needs-you', { method: 'GET' });
      expect(read.status).toBe(200);
      return read.json.conditions;
    };

    expect(await git.post()).toMatchObject({ status: 200, ok: true });
    await cutover(NOW);
    const first = await needsYou();
    expect(first).toEqual([expect.objectContaining({
      ticket_id: 'docs:STUCK', type: TYPE, disposition: 'notify', leg: null, run_id: null,
    })]);
    const id = first[0].condition_id;
    const runner = await grantedRunner(owner, 'docs', 'runner', ['agent-venue']);
    expect((await runner.call('/v1/runner/claim', { request_id: 'req-stuck', ticket_id: 'docs:STUCK', leg: 'review' })).json.code).toBe('not-eligible');
    expect((await runner.call('/v1/runner/claim', { request_id: 'req-ready', ticket_id: 'docs:READY' })).status).toBe(200);

    await setClock(NOW + 60_000);
    expect((await git.refresh()).status).toBe(200);
    expect(await needsYou()).toEqual(first);

    git.place('STUCK', fixed);
    expect((await git.refresh()).status).toBe(200);
    expect(await needsYou()).toEqual([]);
    expect(await rows('SELECT outcome, closed_at FROM conditions WHERE id = ?', id)).toEqual([{ outcome: 'closed', closed_at: NOW + 60_000 }]);

    git.place('STUCK', missing);
    expect((await git.post()).status).toBe(200);
    expect(await needsYou()).toEqual([expect.objectContaining({ condition_id: id, detail: { reraised: 1 } })]);

    git.close('STUCK', 'withdrawn');
    expect((await git.post()).status).toBe(200);
    expect(await needsYou()).toEqual([]);

    await setClock(NOW + 3_660_001);
    git.add('LATE', {}, placed('pr-open', path, [])).add('STUCK', {}, missing);
    expect((await git.refresh()).status).toBe(200);
    const open = await needsYou();
    expect(open.map((c: { ticket_id: string }) => c.ticket_id)).toEqual(['docs:LATE', 'docs:STUCK']);
    expect(open[1].condition_id).not.toBe(id);

    git.place('STUCK', fixed).place('LATE', end);
    expect((await git.post()).status).toBe(200);
    expect(await needsYou()).toEqual([]);
    const another = await grantedRunner(owner, 'docs', 'another', ['agent-venue']);
    expect((await another.call('/v1/runner/claim', { request_id: 'req-fixed', ticket_id: 'docs:STUCK' })).status).toBe(200);
  });
});
