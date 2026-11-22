// S-BTN-24 and the short-form resource prerequisite of S-BTN-181, on both hosts.
import { expect, it } from 'vitest';
import { advance, claimItem, course, cutover, Git, keyCall, placed, register, recommended, rows, setAdminKeys, setClock } from '../helpers';
import { SCHEMA, signed } from '../lib/fleet';
import { makeKey } from '../lib/sshKeys';

it('refuses resource gates at claim and advance, independently of fleet advice', async () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  await setClock(now);
  const admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
  const owner = await makeKey('ssh-ed25519', 'owner');
  const probe = await makeKey('ssh-ed25519', 'probe');
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  for (const resource of ['funds', 'fleet']) {
    expect((await keyCall(admin, '/v1/admin/resources', { name: resource, scope: 'service', detail_schema: SCHEMA })).status).toBe(200);
  }
  expect((await keyCall(admin, '/v1/admin/probes', { public_key: probe.publicKey, label: 'probe' })).status).toBe(200);
  const reading = (instance: string, available: boolean, valid_for = 600) => ({ readings: [{ instance, available, valid_for }] });
  const git = new Git();
  git.registry = [course(1, 1, { course: {
    start: 'filed', start_leg: 'prepare', end: ['done'],
    stations: { filed: {}, prepared: {}, done: {} },
    legs: {
      prepare: { from: ['filed'], to: 'prepared' },
      spend: { from: ['prepared'], to: 'done', requires: { resources: [{ resource: 'funds', binds: 'gate', writers: ['instrument'] }] } },
    },
  } })];
  git.add('A', {}, { ...placed('prepared', [['prepare', 'prepared']], [['spend', 'ready']]), next: [{ leg: 'spend', state: 'ready', needs: ['fleet'] }] });
  git.add('B', {}, placed('filed', [], [['prepare', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover(now);
  const runner = await register('vm-a');
  const blocks = () => rows('SELECT kind, binds, why, ref FROM ticket_blocks WHERE ticket_id = ? ORDER BY ref', 'docs:A');
  const claim = () => claimItem('vm-a', runner.secret, { ticket_id: 'docs:A' });
  expect((await keyCall(admin, '/v1/admin/readings', reading('fleet', false))).status).toBe(200);
  expect(await blocks()).toEqual([
    { kind: 'resource', binds: null, why: null, ref: 'fleet' },
    { kind: 'resource', binds: 'gate', why: 'missing', ref: 'funds' },
  ]);
  expect((await claim()).json).toMatchObject({ code: 'blocked', rule: 1 });
  expect((await keyCall(admin, '/v1/admin/readings', reading('funds', true))).status).toBe(200);
  expect((await claim()).json).toMatchObject({ code: 'blocked', rule: 1 });
  expect(await blocks()).toContainEqual({ kind: 'resource', binds: 'gate', why: 'writer-not-allowed', ref: 'funds' });
  const b = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:B' });
  expect(b.status).toBe(200);
  expect((await advance('vm-a', runner.secret, b.json.claim_id, { leg: 'prepare' })).status).toBe(200);
  const spend = () => advance('vm-a', runner.secret, b.json.claim_id, { leg: 'spend', reached: 'prepared' });
  expect((await spend()).json).toMatchObject({ code: 'blocked', rule: 1 });
  expect((await signed(probe, '/v1/probe/readings', { body: reading('funds', true, 60) })).json).toMatchObject({ refused: [] });
  expect(await blocks()).toEqual([{ kind: 'resource', binds: null, why: null, ref: 'fleet' }]);
  expect((await spend()).status).toBe(200);
  const idle = await register('vm-b');
  await setClock(now + 60_000);
  expect((await claimItem('vm-b', idle.secret, { ticket_id: 'docs:A' })).json).toMatchObject({ code: 'blocked', rule: 1 });
  expect(await recommended(idle.id)).not.toContain('docs:A');
  expect(await blocks()).toContainEqual({ kind: 'resource', binds: 'gate', why: 'writer-not-allowed', ref: 'funds' });
});
