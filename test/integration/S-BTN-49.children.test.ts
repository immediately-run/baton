// S-BTN-49 child tickets (BATON_SPEC §15, §4.6 R-BTN-86; R3-1258): tickets are sequential and
// child tickets are the parallelism primitive. Must hold, this landing's non-call half (the
// call clause is B-62's): a `spawned` end's bounds and its refusals; children and parent held
// at once; the `children` read listing open and closed; bad parents `parent-invalid`, stored as
// none, never refusing the snapshot; no provisional block is written for a `spawned` child; and
// a child the first snapshot after the end does not post is `spawned-unposted` (R-BTN-85). The
// pure half is test/unit/children.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  advance, claimItem, endClaim, cutover, Git, keyCall, placed, q, register, rows, setAdminKeys, setClock,
  seedTicketBlock,
} from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-18T12:00:00Z');

let admin: TestKey;
let owner: TestKey;
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] });
  git = new Git().add('T');
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
});

const parentInvalid = () => rows<{ ticket_id: string; detail_json: string }>(`SELECT ticket_id, detail_json FROM events WHERE kind = 'parent-invalid' ORDER BY seq`)
  .then((rs) => rs.map((r) => ({ ticket: r.ticket_id, ...(JSON.parse(r.detail_json) as { reason: string } & Record<string, unknown>) })));
const childrenOf = async (local: string) => keyCall(admin, `/v1/repositories/docs/tickets/${local}/children`);
const discrepancy = (local: string, sub: string) => rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'discrepancy' AND ticket_id = ? AND json_extract(detail_json, '$.sub') = ?`, q(local), sub)
  .then((rs) => rs.map((r) => JSON.parse(r.detail_json)));

describe('S-BTN-49 child tickets (R3-1258: the non-call cases)', () => {
  it('a spawned end reports its children; 51 ids, the parent itself, done, and an advance with spawned are each invalid-params', async () => {
    const w = await register('vm-a');
    const c = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:T' })).json;
    // The refusals come first — none of them ends the claim, so all land on the one holder.
    const ids = Array.from({ length: 51 }, (_, i) => `K${i}`);
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:requested', spawned: ids })).json.code).toBe('invalid-params');
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:requested', spawned: ['T'] })).json.code).toBe('invalid-params');
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'done', reached: 'merged', spawned: ['C1'] })).json.code).toBe('invalid-params');
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'review', spawned: ['C1'] as never })).json.code).toBe('invalid-params');
    // The good report, on a release: recorded as the run's children.
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:requested', spawned: ['C1', 'C2'] })).status).toBe(200);
    expect((await rows<{ ticket_id: string; children_json: string }>('SELECT ticket_id, children_json FROM spawned_children')).map((r) => [r.ticket_id, JSON.parse(r.children_json)]))
      .toEqual([['docs:T', ['C1', 'C2']]]);
  });

  it('children and the parent are held at once, and no provisional block is written for a spawned child', async () => {
    git.add('C1', { parent: 'T' }, placed('filed', [], [['implement', 'ready']]));
    expect((await git.post()).status).toBe(200);
    const parentRunner = await register('vm-a');
    const childRunner = await register('vm-b');
    const parent = await claimItem('vm-a', parentRunner.secret, { ticket_id: 'docs:T' });
    expect(parent.status).toBe(200);
    // The child is claimable while the parent is held — an open child blocks its parent only
    // through a call (B-62), so nothing refuses this.
    const child = await claimItem('vm-b', childRunner.secret, { ticket_id: 'docs:C1' });
    expect(child.status).toBe(200);
    expect((await rows<{ ticket_id: string }>('SELECT ticket_id FROM claims WHERE status = \'active\' ORDER BY ticket_id')).map((r) => r.ticket_id)).toEqual(['docs:C1', 'docs:T']);
    // G-BTN-76's non-call clause: the spawned report writes no `ticket` block — not for the
    // child it names, not for one it merely reports.
    expect((await endClaim('vm-b', childRunner.secret, child.json.claim_id, { end_reason: 'released:requested', spawned: ['C2'] })).status).toBe(200);
    expect((await rows(`SELECT 1 FROM ticket_blocks WHERE kind = 'ticket'`)).length).toBe(0);
  });

  it('the children read lists open and closed children with station and blocked state', async () => {
    git
      .add('C1', { parent: 'T' }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]))
      .add('C2', { parent: 'T' }, placed('filed', [], [['implement', 'ready']]));
    expect((await git.post()).status).toBe(200);
    const open = await childrenOf('T');
    expect(open.status).toBe(200);
    expect(open.json.children).toEqual([
      { ticket_id: 'docs:C1', station: 'pr-open', blocked: false },
      { ticket_id: 'docs:C2', station: 'filed', blocked: false },
    ]);
    // A blocked child shows it; a closed one shows its closure.
    await seedTicketBlock({ ticket_id: 'docs:C2', repository_id: 'docs', kind: 'capability', ref: 'no-such', leg: '', since: 0 });
    git.close('C1', 'done');
    expect((await git.post()).status).toBe(200);
    const after = await childrenOf('T');
    expect(after.json.children).toEqual([
      { ticket_id: 'docs:C2', station: 'filed', blocked: true },
      { ticket_id: 'docs:C1', station: null, blocked: false, closed: { as: 'done', closed_at: expect.any(Number) } },
    ]);
    // A parent no child names: an empty list, never an error.
    const ghost = await childrenOf('GHOST');
    expect(ghost.status).toBe(200);
    expect(ghost.json.children).toEqual([]);
  });

  it('bad parents are parent-invalid — stored as none, never refusing the snapshot; an orphan is stored', async () => {
    git
      .add('SELF', { parent: 'SELF' })
      .add('FOREIGN', { parent: 'ops:X' })
      .add('A', { parent: 'B' })
      .add('B', { parent: 'A' })
      .add('ORPHAN', { parent: 'GHOST' });
    expect((await git.post()).status).toBe(200);
    const invalid = await parentInvalid();
    const by = new Map(invalid.map((x) => [x.ticket, x.reason]));
    expect(by.get('docs:SELF')).toBe('self');
    expect(by.get('docs:FOREIGN')).toBe('foreign');
    expect(by.get('docs:A')).toBe('cycle');
    expect(by.get('docs:B')).toBe('cycle');
    expect(invalid.length).toBe(4);
    const stored = (local: string) => rows<{ parent: string | null }>('SELECT parent FROM tickets WHERE local_id = ?', local).then((r) => (r.length ? r[0].parent : 'NO ROW'));
    expect(await stored('SELF')).toBeNull();
    expect(await stored('FOREIGN')).toBeNull();
    expect(await stored('A')).toBeNull();
    // An orphan's parent is stored, drawn orphaned.
    expect(await stored('ORPHAN')).toBe('docs:GHOST');
    // An orphan's spawn row is held for no one: nothing lands on an unknown ticket's history.
    expect((await rows(`SELECT 1 FROM ticket_history WHERE kind = 'spawned'`)).length).toBe(0);
  });

  it('a reported child the first snapshot after the end does not post is spawned-unposted; a posted one stays recorded', async () => {
    const w = await register('vm-a');
    const c = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:T' })).json;
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:requested', spawned: ['C1', 'NOPE'] })).status).toBe(200);
    git.add('C1', { parent: 'T' });
    expect((await git.post()).status).toBe(200);
    const dropped = await discrepancy('T', 'spawned-unposted');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ baton: { children: ['C1', 'NOPE'] }, git: { posted: ['C1'] } });
    expect((await rows<{ children_json: string }>('SELECT children_json FROM spawned_children')).map((r) => JSON.parse(r.children_json))).toEqual([['C1']]);
    // The `spawned` history row lands on the parent when the child first appears (R-BTN-86).
    const spawned = await rows<{ ticket_id: string; detail_json: string }>(`SELECT ticket_id, detail_json FROM ticket_history WHERE kind = 'spawned'`);
    expect(spawned.map((r) => [r.ticket_id, (JSON.parse(r.detail_json) as { child: string }).child])).toContainEqual(['docs:T', 'docs:C1']);
  });
});
