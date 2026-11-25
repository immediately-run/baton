// S-BTN-24 advice, not gates (BATON_SPEC §15, R-BTN-45, §6.6's gate table; R3-1232): a runner claims
// a ticket ranked fifth; a third claims a ticket above its tier, and a fourth a ticket a suspended
// line would spend. Must hold: the first is accepted without an override; the third is
// refused not-eligible naming the tier rule, the fourth barred-tag. Here the sync posts the bar on the leg.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { claimItem, cutover, Git, placed, register, rows, setClock } from '../helpers';

const T0 = Date.parse('2026-10-16T12:00:00Z');
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  git = new Git();
  for (let i = 1; i <= 5; i++) git.add(`T-${i}`, { rank: i });
  git.add('BIG', { rank: 6, tier: 'critical' });
  git.add('LINE', { rank: 7 }, placed('filed', [], [['implement', 'ready']], { bars: { implement: ['account:go_plus'] } }));
  await git.post();
  await cutover();
});

describe('S-BTN-24 advice, not gates', () => {
  it('the order is advice; the tier and a barred tag are gates', async () => {
    const first = await register('vm-a');
    const c = await claimItem('vm-a', first.secret, { ticket_id: 'docs:T-5' });
    expect(c.status).toBe(200);
    expect(await rows(`SELECT 1 FROM events WHERE kind = 'advice-overridden' AND claim_id = ?`, c.json.claim_id)).toEqual([]);

    const third = await register('vm-b', { tier_ceiling: 'judgement' });
    expect(await claimItem('vm-b', third.secret, { ticket_id: 'docs:BIG' })).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 5, rule_code: 'above-tier-ceiling' } });

    const fourth = await register('test', { tags: ['account:go_plus', 'family:qwen'] });
    expect(await claimItem('test', fourth.secret, { ticket_id: 'docs:LINE' })).toMatchObject({ status: 409, json: { code: 'barred-tag', rule: 8 } });
    const offered = await claimItem('test', fourth.secret);
    expect(offered.json.ticket_id).toBe('docs:T-1');
  });
});
