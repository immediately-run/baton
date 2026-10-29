// S-BTN-188 a sync writes only what changed (BATON_SPEC §15, R-BTN-70, R-BTN-2): the sync re-posts
// every live ticket's station, next legs and bars on every push and every refresh. Must hold: a
// refresh that changes nothing rewrites no station, next-leg or bar row; a new head that moves one
// ticket rewrites that ticket's rows alone; a reading that leaves a row unchanged still counts as
// showing the ticket there — it confirms an end made before it. Runs on both hosts: a row's rowid
// changes when it is deleted and inserted again, and its `observation` when it is rewritten.
import { describe, it, expect, beforeEach } from 'vitest';
import { advance, claimItem, claimRow, cutover, endClaim, Git, placed, register, rows, setClock } from '../helpers';

const T0 = Date.parse('2026-10-29T12:00:00Z');
const IDS = Array.from({ length: 12 }, (_, i) => `T-${i + 1}`);
let git: Git;

const state = async () => ({
  stations: await rows('SELECT ticket_id, station, observation, snapshot_sha FROM ticket_stations ORDER BY ticket_id'),
  legs: await rows('SELECT rowid AS r, ticket_id, leg, state, waiting_on, ready_since, waiting_since FROM ticket_next_legs ORDER BY ticket_id, leg'),
  bars: await rows('SELECT rowid AS r, ticket_id, leg, tag FROM ticket_bars ORDER BY ticket_id, leg, tag'),
});
const of = (s: Awaited<ReturnType<typeof state>>, id: string) => ({
  stations: s.stations.filter((r) => r.ticket_id === `docs:${id}`),
  legs: s.legs.filter((r) => r.ticket_id === `docs:${id}`),
  bars: s.bars.filter((r) => r.ticket_id === `docs:${id}`),
});
const others = (s: Awaited<ReturnType<typeof state>>, id: string) => ({
  stations: s.stations.filter((r) => r.ticket_id !== `docs:${id}`),
  legs: s.legs.filter((r) => r.ticket_id !== `docs:${id}`),
  bars: s.bars.filter((r) => r.ticket_id !== `docs:${id}`),
});

beforeEach(async () => {
  await setClock(T0);
  git = new Git();
  for (const id of IDS) git.add(id, {}, placed('filed', [], [['implement', 'ready']], { bars: { implement: ['family:glm', 'family:qwen'] } }));
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-188 a sync writes only what changed', () => {
  it('a refresh that changes nothing rewrites no station, next-leg or bar row', async () => {
    const before = await state();
    expect(before.stations).toHaveLength(IDS.length);
    expect(before.bars).toHaveLength(IDS.length * 2);
    await setClock(T0 + 60_000);
    expect(await git.refresh()).toMatchObject({ status: 200 });
    expect(await state()).toEqual(before);
    expect(await git.post()).toMatchObject({ status: 200, upserted: 0 });
    expect(await state()).toEqual(before);
  });

  it('a new head that moves one ticket rewrites that ticket’s rows alone', async () => {
    const before = await state();
    await setClock(T0 + 60_000);
    git.place('T-3', placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'ci']], { bars: { review: ['family:glm'] } }));
    expect(await git.post()).toMatchObject({ status: 200 });
    const after = await state();
    expect(others(after, 'T-3')).toEqual(others(before, 'T-3'));
    expect(of(after, 'T-3')).toMatchObject({
      stations: [{ station: 'pr-open', snapshot_sha: git.head }],
      legs: [{ leg: 'review', state: 'waiting', waiting_on: 'ci', ready_since: null, waiting_since: T0 + 60_000 }],
      bars: [{ leg: 'review', tag: 'family:glm' }],
    });
    // One leg's state flips and one bar goes: the station row and the kept bar stay as they were.
    git.place('T-3', placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']], { bars: {} }));
    await setClock(T0 + 120_000);
    expect(await git.refresh()).toMatchObject({ status: 200 });
    const last = await state();
    expect(of(last, 'T-3').stations).toEqual(of(after, 'T-3').stations);
    expect(of(last, 'T-3').legs).toMatchObject([{ leg: 'review', state: 'ready', waiting_on: null, ready_since: T0 + 120_000, waiting_since: null }]);
    expect(of(last, 'T-3').bars).toEqual([]);
    expect(others(last, 'T-3')).toEqual(others(before, 'T-3'));
  });

  it('a reading that leaves the station row unchanged still confirms an end made before it', async () => {
    const w1 = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w1.secret, { ticket_id: 'docs:T-1' });
    await advance('vm-a', w1.secret, c.claim_id, { leg: 'implement' });
    git.place('T-1', placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'review-seats']]));
    await git.post();
    expect((await endClaim('vm-a', w1.secret, c.claim_id, { end_reason: 'suspended:pr-open' })).status).toBe(200);
    expect((await claimRow(c.claim_id)).confirmed_at).toBeNull();
    const before = of(await state(), 'T-1');
    await setClock(T0 + 60_000);
    // The refresh posts T-1 exactly as stored: no row is rewritten, and the end is confirmed.
    expect(await git.refresh()).toMatchObject({ status: 200, confirmed: 1 });
    expect(of(await state(), 'T-1')).toEqual(before);
    expect((await claimRow(c.claim_id)).confirmed_at).toBe(T0 + 60_000);
  });
});
