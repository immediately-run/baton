import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/migrations';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { Git, course, cutover, keyCall, placed, rows, setAdminKeys, setClock, withCore } from '../helpers';
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

  it.each(['post', 'refresh'] as const)('settles a %s against the placement after its decision attestation', async (method) => {
    await setClock(NOW);
    const git = new Git().add('DECIDED', {}, placed('reviewed', [...path, ['review', 'reviewed']], [['decide', 'ready']], { next_leg: null }));
    git.registry = [course(3, 3, { course: {
      ...roadmapPr,
      legs: {
        ...roadmapPr.legs,
        decide: { from: ['reviewed'], to: ['adjudicated'], kind: 'person', asks: 'owner' },
      },
    } })];
    expect((await git.post()).status).toBe(200);
    const conditions = () => rows('SELECT outcome FROM conditions WHERE type = ? AND ticket_id = ?', TYPE, 'docs:DECIDED');
    expect(await conditions()).toEqual([{ outcome: 'open' }]);

    // The attested person leg leaves this station even though no leg is queued (R-BTN-39).
    const answer = { attestations: [{ type: 'std:decision@1', ticket: 'DECIDED', ref: 'a'.repeat(40),
      value: { id: 'q-1', leg: 'decide', option: 'adjudicated', reached: 'adjudicated' } }] };
    expect((await git[method](answer)).status).toBe(200);
    expect(await rows('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', 'docs:DECIDED'))
      .toEqual([{ station: 'adjudicated', next_leg: 'merge' }]);
    expect(await conditions()).toEqual([{ outcome: 'closed' }]);
    expect((await git.refresh(answer)).status).toBe(200);
    expect((await git.refresh(answer)).status).toBe(200);
    expect(await conditions()).toEqual([{ outcome: 'closed' }]);
  });

  it('reprocesses an unchanged refresh after upgrade and preserves the retention index', async () => {
    await setClock(NOW);
    const git = new Git().add('STUCK', {}, placed('pr-open', path, [['review', 'ready']], { next_leg: null }));
    expect((await git.post()).status).toBe(200);
    expect((await git.refresh()).status).toBe(200);

    // Keep the actual refresh fingerprint and station rows, but restore the pre-0075 conditions
    // schema, which could not hold the notice. Then run the production migrator on that state.
    await withCore((core) => {
      const { store } = core;
      const previous = MIGRATIONS.find((m) => m.id === 48)!.sql.match(/CREATE TABLE conditions \([\s\S]*?CREATE INDEX conditions_by_run ON conditions\(run_id\);/)![0];
      store.transaction(() => {
        store.exec('DROP TABLE conditions');
        store.script(previous);
        store.exec('CREATE INDEX conditions_by_claim ON conditions(claim_id)');
        store.exec('DELETE FROM _baton_migrations WHERE id = 75');
      });
      expect(store.exec('SELECT digest FROM sync_fingerprints WHERE repository_id = ?', 'docs').toArray()).toHaveLength(1);
      core.migrate();
    });
    expect(await rows('SELECT digest FROM sync_fingerprints WHERE repository_id = ?', 'docs')).toEqual([]);
    const plan = await rows<{ detail: string }>('EXPLAIN QUERY PLAN SELECT 1 FROM conditions WHERE claim_id = ?', 1);
    expect(plan.map((r) => r.detail).join('\n')).toMatch(/SEARCH conditions USING COVERING INDEX conditions_by_claim/);

    expect((await git.refresh()).status).toBe(200);
    const notices = () => rows('SELECT id, outcome FROM conditions WHERE type = ? AND ticket_id = ?', TYPE, 'docs:STUCK');
    const first = await notices();
    expect(first).toEqual([{ id: expect.any(Number), outcome: 'open' }]);
    expect((await git.refresh()).status).toBe(200);
    expect(await notices()).toEqual(first);
  });
});
