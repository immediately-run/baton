// S-BTN-22 review queue bound (BATON_SPEC §15, R-BTN-45, §6.6's default order; R3-1232): eight
// tickets wait for review, none with room. No core rule bounds the queue — that rule retired with
// the rewrite; the bound is `roadmap-pr`'s ranking code in docs, and core counts `max_queue`
// (R-BTN-79). Core's half: the default order applies — expedite, then resume before start
// (`to_end`), rank, age, id — nothing is flagged, and a runner that claims against the order is
// accepted without recording an override. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { claimItem, cutover, Git, placed, register, rows, setClock, runnerCall, keyCall, setAdminKeys } from '../helpers';

import { grantedRunner } from '../lib/fleet';
import { makeKey } from '../lib/sshKeys';
import { plan, printTicketOrder } from '../../cli/baton.mjs';

const T0 = Date.parse('2026-10-16T12:00:00Z');
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  git = new Git();
  // Eight tickets wait for review (not ready: no seat has room); three are ready to start; one
  // is reviewed with merge ready; one fixed with review ready.
  for (let i = 1; i <= 8; i++) git.add(`R-${i}`, { rank: i }, placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'review-seats']]));
  for (let i = 1; i <= 3; i++) git.add(`F-${i}`, { rank: 20 + i });
  git.add('M-1', { rank: 40 }, placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['merge', 'ready']]));
  git.add('X-1', { rank: 30 }, placed('fixed', [['implement', 'pr-open'], ['review', 'reviewed'], ['fix', 'fixed']], [['review', 'ready']]));
  await git.post();
  await cutover();
});

describe('S-BTN-22 review queue bound', () => {
  it('core’s default order, nothing flagged; a claim against it is accepted without an override', async () => {
    const w = await register('vm-a');
    const res = await runnerCall('/v1/runner/recommendations?limit=50', { secret: w.secret });
    const recs = ((await res.json()) as { recommendations: { ticket_id: string; station: string; legs: string[]; flags: string[]; score: unknown }[] }).recommendations;
    // Resume before start: one leg to an end (M-1 at reviewed), then two (X-1 at fixed), then the
    // filed tickets by rank; the waiting reviews are not offered at all.
    expect(recs.map((r) => [r.ticket_id, r.station, r.legs])).toEqual([
      ['docs:M-1', 'reviewed', ['merge']], ['docs:X-1', 'fixed', ['review']],
      ['docs:F-1', 'filed', ['implement']], ['docs:F-2', 'filed', ['implement']], ['docs:F-3', 'filed', ['implement']]]);
    expect(recs.every((r) => r.flags.length === 0 && !('score' in r))).toBe(true);
    // ?limit= applies after the merge.
    const two = (await (await runnerCall('/v1/runner/recommendations?limit=2', { secret: w.secret })).json()) as { recommendations: unknown[] };
    expect(two.recommendations).toHaveLength(2);
    expect((await runnerCall('/v1/runner/recommendations?limit=0', { secret: w.secret })).status).toBe(400);
    // A runner that starts a new ticket anyway is accepted, without a recorded override.
    const c = await claimItem('vm-a', w.secret, { ticket_id: 'docs:F-3' });
    expect(c.status).toBe(200);
    expect(await rows(`SELECT 1 FROM events WHERE kind = 'advice-overridden' AND claim_id = ?`, c.json.claim_id))
      .toEqual([]);
  });

  it('prints the served offer order and keys, and exposes the same runner positions on the board and tickets', async () => {
    const admin = await makeKey('ssh-ed25519', 'admin');
    const owner = await makeKey('ssh-ed25519', 'owner');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
    git.add('F-NO-RANK', { rank: null });
    git.add('F-INELIGIBLE', { rank: 0, requires: ['never-declared'] });
    await git.post();
    const runner = await grantedRunner(owner, 'docs', 'ordered', ['agent-venue']);
    const endpoint = '/v1/runner/recommendations?all=1';
    const expected = (await runner.call(endpoint, undefined, 'GET')).json.recommendations;
    const ids = ['docs:M-1', 'docs:X-1', 'docs:F-1', 'docs:F-2', 'docs:F-3', 'docs:F-NO-RANK'];
    expect(expected.map((r: { ticket_id: string }) => r.ticket_id)).toEqual(ids);
    const lines: string[] = [];
    expect(await printTicketOrder(plan('tickets', ['order', '--ready']), ({ path }: { path: string }) => runner.call(path, undefined, 'GET'), (line: string) => lines.push(line))).toBe(0);
    expect(lines.slice(1).map((line) => line.split('\t')[0])).toEqual(ids);
    expect(lines[1].split('\t')).toEqual(['docs:M-1', '1', 'false', '1', '40', String(T0), 'roadmap-pr', '100', '1', 'ready']);
    expect(lines.at(-1)?.split('\t')[4]).toBe('-');

    const board = (await runner.call('/v1/repositories/docs/board', undefined, 'GET')).json.ready;
    const tickets = (await runner.call('/v1/repositories/docs/tickets?state=ready', undefined, 'GET')).json.tickets;
    for (const [i, id] of ids.entries()) {
      expect(board[i]).toMatchObject({ id, rank: expected[i].order.rank, ready_position: i + 1 });
      expect(tickets[i]).toMatchObject({ ticket_id: id, rank: expected[i].order.rank, ready_position: i + 1 });
    }
    expect(tickets.find((r: { ticket_id: string }) => r.ticket_id === 'docs:F-INELIGIBLE')).toMatchObject({ ready_position: null });
  });

  it('age breaks a tie of station and rank: the leg ready longest first, then the id', async () => {
    git.add('A-2', { rank: 50 });
    git.add('A-1', { rank: 50 });
    await git.post();
    await setClock(T0 + 60_000);
    git.add('A-0', { rank: 50 });
    await git.post();
    const w = await register('vm-a');
    const recs = ((await (await runnerCall('/v1/runner/recommendations?limit=50', { secret: w.secret })).json()) as { recommendations: { ticket_id: string }[] }).recommendations;
    expect(recs.map((r) => r.ticket_id).slice(-3)).toEqual(['docs:A-1', 'docs:A-2', 'docs:A-0']);
  });
});
